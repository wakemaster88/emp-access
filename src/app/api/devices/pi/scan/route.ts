import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { checkWakesys } from "@/lib/wakesys";
import { checkBinarytec } from "@/lib/binarytec";

/** Code vom Raspberry Pi, wenn Relais per Dashboard-Button geöffnet wurde → GRANTED-Scan ohne Ticket */
const DASHBOARD_OPEN_CODE = "__DASHBOARD_OPEN__";

export async function POST(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;

  const body = await request.json();
  const rawCode = String(body.code ?? "").trim();
  const code = rawCode.replace(/\s+/g, "");
  const stripped = code.replace(/^[#%]+/, "");
  const deviceId = Number(body.deviceId);

  if (!code) return NextResponse.json({ error: "Missing code" }, { status: 400 });
  if (isNaN(deviceId)) return NextResponse.json({ error: "Missing deviceId" }, { status: 400 });

  const { db } = auth;
  const accountId = auth.account.id;

  const device = await db.device.findFirst({
    where: { id: deviceId, accountId, type: "RASPBERRY_PI" },
  });
  if (!device) return NextResponse.json({ error: "Device not found" }, { status: 404 });
  if (!device.isActive) {
    return NextResponse.json({ granted: false, message: "Gerät deaktiviert" });
  }

  if (device.task === 3) {
    return NextResponse.json({ granted: false, message: "Gerät gesperrt" });
  }

  // Dashboard-Öffnung: Relais wurde per Button geöffnet → GRANTED-Scan ohne Ticket anlegen
  if (code === DASHBOARD_OPEN_CODE) {
    await db.scan.create({
      data: { code: "Dashboard-Öffnung", deviceId, result: "GRANTED", accountId },
    });
    return NextResponse.json({ granted: true, message: "Dashboard-Öffnung erfasst" });
  }

  // Wenn Binarytec konfiguriert: nur Binarytec für Ticketprüfung (kein Sync, kein EMP-Ticket-Lookup)
  const binarytec = await checkBinarytec(db as Parameters<typeof checkBinarytec>[0], accountId, code);
  if (binarytec !== null) {
    if (binarytec.valid) {
      await db.scan.create({
        data: { code, deviceId, result: "GRANTED", accountId },
      });
      return NextResponse.json({
        granted: true,
        message: "Zutritt gewährt (Binarytec)",
      });
    }
    await db.scan.create({
      data: { code, deviceId, result: "DENIED", accountId },
    });
    return NextResponse.json({ granted: false, message: "Zutritt verweigert (Binarytec)" });
  }

  // EMP-Tickets und ggf. Wakesys-Fallback
  const codesToTry = stripped && stripped !== code
    ? [code, rawCode, stripped]
    : [code, rawCode];
  let ticket = null;
  for (const c of codesToTry) {
    const candidates = await db.ticket.findMany({
      where: {
        accountId,
        OR: [
          { qrCode: c },
          { rfidCode: c },
          { barcode: c },
          { uuid: c },
        ],
      },
      include: {
        service: {
          select: {
            allowReentry: true,
            name: true,
            serviceAreas: { select: { accessAreaId: true } },
          },
        },
        subscription: {
          select: {
            name: true,
            areas: { select: { id: true } },
          },
        },
        ticketAreas: { select: { accessAreaId: true } },
      },
    });
    if (candidates.length > 0) {
      const now = new Date();
      function ticketScore(t: typeof candidates[0]): number {
        if (t.status === "INVALID" || t.status === "PROTECTED") return 0;
        const endOk = !t.endDate || new Date(new Date(t.endDate).setUTCHours(23, 59, 59, 999)) >= now;
        const startOk = !t.startDate || new Date(t.startDate) <= now;
        if (endOk && startOk && t.status === "VALID") return 4;
        if (endOk && startOk && t.status === "REDEEMED") return 3;
        if (endOk && startOk) return 2;
        return 1;
      }
      candidates.sort((a, b) => ticketScore(b) - ticketScore(a));
      ticket = candidates[0];
      break;
    }
  }

  if (!ticket) {
    // Gutschein-Einlösung: Code beginnt mit "GS-"
    if (code.startsWith("GS-")) {
      const voucher = await db.voucher.findUnique({ where: { code, accountId } });
      if (voucher && !voucher.redeemedAt) {
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        const todayEnd = new Date(today);
        todayEnd.setUTCHours(23, 59, 59, 999);

        // Atomar: Ticket anlegen + Voucher nur einlösen, wenn noch nicht eingelöst.
        // Bei paralleler Einlösung gewinnt genau einer (updateMany count=1).
        // set_config in der Transaktion, damit RLS weiterhin greift (vgl. Hinweis oben).
        const redeemed = await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${String(accountId)}, TRUE)`;
          const newTicket = await tx.ticket.create({
            data: {
              name: voucher.ticketTypeName ?? "Gutschein-Ticket",
              ticketTypeName: voucher.ticketTypeName,
              startDate: today,
              endDate: todayEnd,
              validityType: voucher.validityType,
              validityDurationMinutes: voucher.validityDurationMinutes,
              serviceId: voucher.serviceId,
              accessAreaId: voucher.accessAreaId,
              status: "REDEEMED",
              accountId,
            },
          });

          const res = await tx.voucher.updateMany({
            where: { id: voucher.id, redeemedAt: null },
            data: { redeemedAt: new Date(), redeemedTicketId: newTicket.id },
          });
          if (res.count === 0) {
            // Paralleler Request hat den Gutschein bereits eingelöst → rollback
            // über Exception; Ticket wird dadurch nicht persistiert.
            throw new Error("VOUCHER_ALREADY_REDEEMED");
          }

          await tx.scan.create({
            data: { code, deviceId, result: "GRANTED", ticketId: newTicket.id, accountId },
          });

          return newTicket;
        }).catch((e) => {
          if (e instanceof Error && e.message === "VOUCHER_ALREADY_REDEEMED") {
            return null;
          }
          throw e;
        });

        if (!redeemed) {
          await db.scan.create({
            data: { code, deviceId, result: "DENIED", accountId },
          });
          return NextResponse.json({ granted: false, message: "Gutschein bereits eingelöst" });
        }

        return NextResponse.json({
          granted: true,
          message: "Gutschein eingelöst",
          ticket: {
            name: redeemed.name,
            firstName: null,
            lastName: null,
            ticketTypeName: redeemed.ticketTypeName,
            subscriptionName: null,
            serviceName: null,
          },
        });
      }

      if (voucher?.redeemedAt) {
        await db.scan.create({
          data: { code, deviceId, result: "DENIED", accountId },
        });
        return NextResponse.json({ granted: false, message: "Gutschein bereits eingelöst" });
      }
    }

    const wakesys = await checkWakesys(db as Parameters<typeof checkWakesys>[0], accountId, stripped || code);
    if (wakesys?.valid) {
      const noteData: Record<string, string | number> = {};
      if (wakesys.name) noteData.name = wakesys.name;
      if (wakesys.picture) noteData.picture = wakesys.picture;
      if (wakesys.age) noteData.age = wakesys.age;
      const note = Object.keys(noteData).length > 0 ? JSON.stringify(noteData) : wakesys.name || null;

      await db.scan.create({
        data: {
          code: stripped || code,
          note,
          deviceId,
          result: "GRANTED",
          accountId,
        },
      });
      return NextResponse.json({
        granted: true,
        message: "Zutritt gewährt (Wakesys)",
      });
    }
    await db.scan.create({
      data: { code: stripped || code, deviceId, result: "DENIED", accountId },
    });
    return NextResponse.json({ granted: false, message: "Ticket nicht gefunden" });
  }

  const ticketInfo = {
    name: ticket.name,
    firstName: ticket.firstName,
    lastName: ticket.lastName,
    ticketTypeName: ticket.ticketTypeName,
    subscriptionName: ticket.subscription?.name ?? null,
    serviceName: ticket.service?.name ?? null,
  };

  if (ticket.status === "INVALID") {
    await db.scan.create({
      data: { code, deviceId, result: "DENIED", ticketId: ticket.id, accountId },
    });
    return NextResponse.json({ granted: false, message: "Ticket ungültig", ticket: ticketInfo });
  }

  if (ticket.status === "PAUSED") {
    await db.scan.create({
      data: { code, deviceId, result: "DENIED", ticketId: ticket.id, accountId },
    });
    return NextResponse.json({ granted: false, message: "Abo pausiert", ticket: ticketInfo });
  }

  if (ticket.status === "CANCELED") {
    await db.scan.create({
      data: { code, deviceId, result: "DENIED", ticketId: ticket.id, accountId },
    });
    return NextResponse.json({ granted: false, message: "Ticket storniert", ticket: ticketInfo });
  }

  if (ticket.status === "PROTECTED") {
    await db.scan.create({
      data: { code, deviceId, result: "PROTECTED", ticketId: ticket.id, accountId },
    });
    return NextResponse.json({ granted: false, message: "Ticket gesperrt", ticket: ticketInfo });
  }

  const now = new Date();
  const vType = ticket.validityType ?? "DATE_RANGE";

  if (ticket.startDate) {
    const start = new Date(ticket.startDate);
    start.setUTCHours(0, 0, 0, 0);
    if (now < start) {
      await db.scan.create({
        data: { code, deviceId, result: "DENIED", ticketId: ticket.id, accountId },
      });
      return NextResponse.json({ granted: false, message: "Ticket noch nicht gültig", ticket: ticketInfo });
    }
  }
  if (ticket.endDate) {
    const end = new Date(ticket.endDate);
    end.setUTCHours(23, 59, 59, 999);
    if (now > end) {
      await db.scan.create({
        data: { code, deviceId, result: "DENIED", ticketId: ticket.id, accountId },
      });
      return NextResponse.json({ granted: false, message: "Ticket abgelaufen", ticket: ticketInfo });
    }
  }

  if (vType === "TIME_SLOT" && ticket.slotStart && ticket.slotEnd) {
    const berlinNow = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Berlin" }));
    const currentMinutes = berlinNow.getHours() * 60 + berlinNow.getMinutes();
    const [sh, sm] = ticket.slotStart.split(":").map(Number);
    const [eh, em] = ticket.slotEnd.split(":").map(Number);
    const slotStartMin = sh * 60 + sm;
    const slotEndMin = eh * 60 + em;
    if (currentMinutes < slotStartMin || currentMinutes > slotEndMin) {
      await db.scan.create({
        data: { code, deviceId, result: "DENIED", ticketId: ticket.id, accountId },
      });
      return NextResponse.json({
        granted: false,
        message: `Zeitslot ${ticket.slotStart}–${ticket.slotEnd} Uhr`,
        ticket: ticketInfo,
      });
    }
  }

  if (vType === "DURATION" && ticket.validityDurationMinutes) {
    if (ticket.firstScanAt) {
      const expiresAt = new Date(ticket.firstScanAt.getTime() + ticket.validityDurationMinutes * 60_000);
      if (now > expiresAt) {
        await db.scan.create({
          data: { code, deviceId, result: "DENIED", ticketId: ticket.id, accountId },
        });
        return NextResponse.json({ granted: false, message: "Zeitgültigkeit abgelaufen", ticket: ticketInfo });
      }
    }
  }

  const isEmployee = ticket.source === "EMP_CONTROL";

  if (device.accessIn || device.accessOut) {
    const deviceAreas = [device.accessIn, device.accessOut].filter(Boolean) as number[];
    const ticketAreaIds = ticket.ticketAreas?.map((ta) => ta.accessAreaId) ?? [];
    const subscriptionAreaIds = ticket.subscription?.areas?.map((a) => a.id) ?? [];
    const serviceAreaIds = ticket.service?.serviceAreas?.map((sa) => sa.accessAreaId) ?? [];
    const allTicketAreas = [
      ...(ticket.accessAreaId ? [ticket.accessAreaId] : []),
      ...ticketAreaIds,
      ...subscriptionAreaIds,
      ...serviceAreaIds,
    ];
    const hasAccess = allTicketAreas.length === 0 || allTicketAreas.some((a) => deviceAreas.includes(a));
    if (!hasAccess) {
      await db.scan.create({
        data: { code, deviceId, result: "DENIED", ticketId: ticket.id, accountId },
      });
      return NextResponse.json({ granted: false, message: "Resource nicht erlaubt", ticket: ticketInfo });
    }
  }

  const isExitScan = device.accessOut != null && ticket.accessAreaId === device.accessOut;
  const serviceAllowsReentry = ticket.service?.allowReentry === true;

  // Reentry-Check: GLOBAL pro Ticket, nicht pro Device. Sonst koennte
  // ein User mit demselben Ticket an Eingang A scannen und kurz darauf
  // an Eingang B – beide Scans wuerden GRANTED sein, weil der frueher
  // device-lokale Check an Eingang B keinen vorherigen Scan sieht.
  //
  // Wir machen den Check fuer JEDEN Nicht-Exit-Scan (also Eingang +
  // mehrdeutige/bidirektionale Geraete). Ein frueherer Filter auf
  // `isEntryScan` (nur wenn device.accessIn === ticket.accessAreaId)
  // war zu restriktiv: wenn das Ticket einen Ober-Bereich hat
  // ("Strandbad") und das Geraet einen spezifischeren ("Strandbad
  // Eingang B"), passt der Vergleich nicht und der ganze Reentry-Block
  // wurde uebersprungen → Mehrfacheinlass.
  if (!isEmployee && !isExitScan && ticket.status === "REDEEMED") {
    if (!serviceAllowsReentry && !device.allowReentry) {
      await db.scan.create({
        data: { code, deviceId, result: "DENIED", ticketId: ticket.id, accountId },
      });
      return NextResponse.json({
        granted: false,
        message: "Ticket bereits eingelöst",
        ticket: ticketInfo,
      });
    }

    // Reentry erlaubt: Eintritt nur, wenn der letzte GRANTED-Scan ein
    // Exit-Scan war (User ist gerade draussen). Sonst ist er bereits
    // drin und versucht das Ticket fuer einen zweiten Eintritt zu
    // nutzen.
    const lastScan = await db.scan.findFirst({
      where: { ticketId: ticket.id, result: "GRANTED" },
      orderBy: { scanTime: "desc" },
      select: {
        device: { select: { accessIn: true, accessOut: true } },
      },
    });
    const lastDev = lastScan?.device;
    const lastWasExit =
      !!lastDev
      && lastDev.accessOut != null
      // Reines Exit-Geraet (kein accessIn) ist eindeutig Exit. Sonst
      // muss der Bereich passen, oder das Ticket hat keinen Bereich.
      && (
        lastDev.accessIn == null
        || ticket.accessAreaId == null
        || lastDev.accessOut === ticket.accessAreaId
      );
    if (!lastWasExit) {
      await db.scan.create({
        data: { code, deviceId, result: "DENIED", ticketId: ticket.id, accountId },
      });
      return NextResponse.json({
        granted: false,
        message: "Bereits drin (kein Ausgang registriert)",
        ticket: ticketInfo,
      });
    }
  }

  // Wenn ein Ticket noch VALID ist, aber das aktuelle Device explizit
  // "kein Reentry" konfiguriert hat UND es bereits einen GRANTED-Scan an
  // diesem Ticket gibt, blockieren wir auch das (Schutzhuelle fuer
  // ungewohnliche Konfigurationen, in denen der Statuswechsel oben
  // ausnahmsweise nicht greift).
  if (!device.allowReentry && !isEmployee && !isExitScan) {
    const existingScan = await db.scan.findFirst({
      where: { ticketId: ticket.id, result: "GRANTED" },
      select: { id: true },
    });
    if (existingScan && !serviceAllowsReentry) {
      await db.scan.create({
        data: { code, deviceId, result: "DENIED", ticketId: ticket.id, accountId },
      });
      return NextResponse.json({
        granted: false,
        message: "Kein Wiedereintritt",
        ticket: ticketInfo,
      });
    }
  }

  // Atomar: Scan + Ticket-State-Transition in einer Transaktion.
  // - Wir nutzen absichtlich `prisma.$transaction` (nicht `db.$transaction`),
  //   weil die tenantClient-Extension pro Einzel-Query ein eigenes $transaction
  //   öffnet – verschachtelt ginge das schief.
  // - Damit RLS im Transaktions-Scope weiterhin greift, setzen wir
  //   set_config manuell als erste Query in der Transaktion.
  // - Optimistic Locking via version verhindert Doppel-Einlösung bei
  //   parallelen Scans (updateMany.count=0 = Konflikt).
  const shouldRedeem =
    ticket.status === "VALID" && !isEmployee && ticket.subscriptionId == null;
  const shouldResetValid =
    ticket.status === "REDEEMED" && isExitScan && !!ticket.service?.allowReentry;

  const txResult = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${String(accountId)}, TRUE)`;

    if (shouldRedeem) {
      const data: { status: "REDEEMED"; version: { increment: number }; firstScanAt?: Date } = {
        status: "REDEEMED",
        version: { increment: 1 },
      };
      if (vType === "DURATION" && !ticket.firstScanAt) {
        data.firstScanAt = now;
      }
      const res = await tx.ticket.updateMany({
        where: { id: ticket.id, status: "VALID", version: ticket.version },
        data,
      });
      if (res.count === 0) {
        return { conflict: true as const };
      }
    } else if (shouldResetValid) {
      const data: { status: "VALID"; version: { increment: number }; firstScanAt?: null } = {
        status: "VALID",
        version: { increment: 1 },
      };
      if (vType === "DURATION") {
        data.firstScanAt = null;
      }
      const res = await tx.ticket.updateMany({
        where: { id: ticket.id, status: "REDEEMED", version: ticket.version },
        data,
      });
      if (res.count === 0) {
        return { conflict: true as const };
      }
    }

    await tx.scan.create({
      data: { code, deviceId, result: "GRANTED", ticketId: ticket.id, accountId },
    });
    return { conflict: false as const };
  });

  if (txResult.conflict) {
    // Paralleler Scan hat den Status bereits geändert → als DENIED loggen (außerhalb
    // der Transaktion, damit der Konflikt-Scan trotzdem erfasst wird).
    await db.scan.create({
      data: { code, deviceId, result: "DENIED", ticketId: ticket.id, accountId },
    });
    return NextResponse.json({
      granted: false,
      message: "Konflikt: Ticket wurde bereits verarbeitet",
      ticket: ticketInfo,
    });
  }

  return NextResponse.json({
    granted: true,
    message: "Zutritt gewährt",
    ticket: ticketInfo,
  });
}
