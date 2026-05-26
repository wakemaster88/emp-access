import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { checkWakesys } from "@/lib/wakesys";
import { checkBinarytec } from "@/lib/binarytec";
import { isWithinSchedule } from "@/lib/schedule";
import { buildScanCodeVariants } from "@/lib/scan-code-variants";

/** Code vom Raspberry Pi, wenn Relais per Dashboard-Button geöffnet wurde → GRANTED-Scan ohne Ticket */
const DASHBOARD_OPEN_CODE = "__DASHBOARD_OPEN__";

/**
 * Mindestlaenge fuer einen plausiblen Scan-Code. Liest der Pi-Scanner
 * QR/RFID nur teilweise, kommen oft 1-5-stellige Stub-Codes wie
 * "0", "JIaj" oder "ClG4c" an (Audit-Rauschen). Mindestlaenge 6 deckt
 * alle bekannten echten Code-Formate ab:
 *   - ANNY/Tristar-Barcodes: `!TIX...` (20 Zeichen, vgl. unten)
 *   - RFID-Tags: 8-10 Ziffern
 *   - Gutschein-Codes: `GS-XXXXXX` (>= 9 Zeichen)
 *   - Sportnavi-URLs: deutlich laenger
 */
const MIN_CODE_LENGTH = 6;

/**
 * ANNY-Barcodes beginnen IMMER mit "!TIX" und haben genau 20 Zeichen
 * (4 Prefix + 16 Token). Wir treffen heute regelmaessig auf Lesefehler,
 * bei denen nur "!TIX" + ein paar Zeichen ankommen (z.B. Scanner-Crash
 * waehrend der Lesung). Solche Stubs verursachen sonst `ticket_not_found`.
 */
const ANNY_BARCODE_PREFIX = "!TIX";
const ANNY_BARCODE_LENGTH = 20;

/**
 * Debounce-Fenster fuer doppelte Scans am selben Geraet mit demselben
 * Code. Hintergrund: Drehkreuz-Scanner senden den gleichen QR-/RFID-
 * Code haeufig mehrfach binnen Sekundenbruchteilen (Hardware-Bouncing
 * oder Mehrfachlesungen). Liegt der vorige Scan innerhalb des Fensters,
 * antworten wir mit seinem Ergebnis und schreiben KEINEN neuen Scan-
 * Datensatz. Spart DB-Schreibvorgaenge und entlastet Reentry-Checks.
 */
const DEBOUNCE_WINDOW_MS = 5_000;

export async function POST(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;

  const body = await request.json();
  const rawCode = String(body.code ?? "").trim();
  const code = rawCode.replace(/\s+/g, "");
  const stripped = code.replace(/^[#%]+/, "");
  const deviceId = Number(body.deviceId);
  // Optional: Drehkreuz/Pi schickt explizit die Bewegungs-Richtung mit
  // ("IN" = Eintritt, "OUT" = Austritt). Dadurch laesst sich auch ein
  // bidirektionales Geraet (accessIn UND accessOut gesetzt) eindeutig
  // einer Richtung zuordnen, statt nur ueber die Geraete-Konfiguration
  // zu raten. Faellt zurueck auf die alte Heuristik, wenn der Pi keine
  // Richtung mitschickt.
  const declaredDirection: "IN" | "OUT" | null =
    typeof body.direction === "string"
      ? body.direction.toUpperCase() === "OUT"
        ? "OUT"
        : body.direction.toUpperCase() === "IN"
          ? "IN"
          : null
      : null;

  if (!code) return NextResponse.json({ error: "Missing code" }, { status: 400 });
  if (isNaN(deviceId)) return NextResponse.json({ error: "Missing deviceId" }, { status: 400 });

  // Lesefehler abfangen. Reservierte Steuer-Codes wie DASHBOARD_OPEN_CODE
  // bleiben davon unberuehrt (laenger als das Limit).
  if (code !== DASHBOARD_OPEN_CODE && code.length < MIN_CODE_LENGTH) {
    return NextResponse.json({
      granted: false,
      message: "Code zu kurz – bitte erneut scannen",
    });
  }

  // ANNY-Barcodes haben eine feste Laenge (20 Zeichen). Eine kuerzere
  // Lesung mit "!TIX"-Prefix ist eindeutig ein Lese-Stub und wird
  // verworfen, damit sie nicht als `ticket_not_found` in der Statistik
  // landet.
  if (code.startsWith(ANNY_BARCODE_PREFIX) && code.length < ANNY_BARCODE_LENGTH) {
    return NextResponse.json({
      granted: false,
      message: "Barcode nur teilweise erkannt – bitte erneut scannen",
    });
  }

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

  // Debounce: hat der gleiche Code am gleichen Geraet innerhalb des
  // letzten DEBOUNCE_WINDOW_MS bereits einen Scan-Eintrag erzeugt, geben
  // wir dessen Resultat zurueck und schreiben keinen neuen Scan. Das
  // verhindert, dass Hardware-Bouncing (z.B. Doppellesungen binnen
  // 0.5-2s) wiederholte DENIED-/GRANTED-Eintraege erzeugt.
  // DASHBOARD_OPEN_CODE ist absichtlich ausgenommen: jeder Button-Klick
  // soll auch dann als separater Scan registriert werden, wenn er kurz
  // hintereinander erfolgt.
  if (code !== DASHBOARD_OPEN_CODE) {
    const recent = await db.scan.findFirst({
      where: {
        code,
        deviceId,
        scanTime: { gte: new Date(Date.now() - DEBOUNCE_WINDOW_MS) },
      },
      orderBy: { scanTime: "desc" },
      select: {
        result: true,
        ticket: {
          select: {
            name: true,
            firstName: true,
            lastName: true,
            ticketTypeName: true,
            subscription: { select: { name: true } },
            service: { select: { name: true } },
          },
        },
      },
    });
    if (recent) {
      const granted = recent.result === "GRANTED";
      return NextResponse.json({
        granted,
        message: granted ? "Zutritt gewährt" : "Bereits gerade abgewiesen",
        debounced: true,
        ticket: recent.ticket
          ? {
              name: recent.ticket.name,
              firstName: recent.ticket.firstName,
              lastName: recent.ticket.lastName,
              ticketTypeName: recent.ticket.ticketTypeName,
              subscriptionName: recent.ticket.subscription?.name ?? null,
              serviceName: recent.ticket.service?.name ?? null,
            }
          : undefined,
      });
    }
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
      data: { code, deviceId, result: "DENIED", note: "binarytec_denied", accountId },
    });
    return NextResponse.json({ granted: false, message: "Zutritt verweigert (Binarytec)" });
  }

  // EMP-Tickets und ggf. Wakesys-Fallback. buildScanCodeVariants liefert
  // Direct-Code, getrimmte Variante, Praefix-gestrippte Variante,
  // DE/US-Layout-Permutationen und Zero-Padding-Fallback (fuer Reader,
  // die fuehrende Nullen unterdruecken). Reihenfolge bleibt insofern
  // unkritisch, als Direct-Lookups ohnehin pro Code erfolgen und das
  // staerkste Match-Scoring weiter unten greift.
  const codesToTry = buildScanCodeVariants(rawCode);
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
        ticketDevices: { select: { deviceId: true } },
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
            data: { code, deviceId, result: "DENIED", note: "voucher_already_redeemed", accountId },
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
          data: { code, deviceId, result: "DENIED", note: "voucher_already_redeemed", accountId },
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
      data: { code: stripped || code, deviceId, result: "DENIED", note: "ticket_not_found", accountId },
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
      data: { code, deviceId, result: "DENIED", note: "status_invalid", ticketId: ticket.id, accountId },
    });
    return NextResponse.json({ granted: false, message: "Ticket ungültig", ticket: ticketInfo });
  }

  if (ticket.status === "PAUSED") {
    await db.scan.create({
      data: { code, deviceId, result: "DENIED", note: "status_paused", ticketId: ticket.id, accountId },
    });
    return NextResponse.json({ granted: false, message: "Abo pausiert", ticket: ticketInfo });
  }

  if (ticket.status === "CANCELED") {
    await db.scan.create({
      data: { code, deviceId, result: "DENIED", note: "status_canceled", ticketId: ticket.id, accountId },
    });
    return NextResponse.json({ granted: false, message: "Ticket storniert", ticket: ticketInfo });
  }

  if (ticket.status === "PROTECTED") {
    await db.scan.create({
      data: { code, deviceId, result: "PROTECTED", note: "status_protected", ticketId: ticket.id, accountId },
    });
    return NextResponse.json({ granted: false, message: "Ticket gesperrt", ticket: ticketInfo });
  }

  const now = new Date();
  const vType = ticket.validityType ?? "DATE_RANGE";

  // Richtungsbestimmung wird hier vorgezogen, damit zeitbasierte
  // Eintritts-Schranken (TIME_SLOT-Fenster, DURATION-Ablauf) nur fuer
  // Eintritte greifen. Ein bereits eingelassener Gast muss durchs
  // Drehkreuz wieder rauskommen koennen, auch wenn er zu spaet rausgeht.
  const isExitScan =
    declaredDirection === "OUT"
    || (
      declaredDirection !== "IN"
      && device.accessOut != null
      && device.accessIn == null
    );

  // "Hauptressource" eines Tickets ist `ticket.accessAreaId`. Nur Scans an
  // Geraeten, die zu diesem Bereich gehoeren (accessIn/accessOut), zaehlen
  // als "verbrauchend": dort startet bei DURATION der Timer und dort wechselt
  // der Status VALID -> REDEEMED. Scans an Nebenressourcen (z.B. Drehkreuz
  // Strandbad fuer ein Wake&Ski-Ticket mit Hauptressource Seilbahn A) werden
  // als "Transit" behandelt: Zutritt wird gewaehrt, aber Status/firstScanAt
  // bleiben unveraendert und die Reentry-Checks ignorieren diese Scans.
  // Wenn das Ticket keine Hauptressource hat (`accessAreaId == null`),
  // verhalten wir uns wie frueher (jeder Scan zaehlt).
  //
  // Diese Berechnung wird hier (vor DURATION-Ablauf-Check) gezogen, weil
  // auch der DURATION-Ablauf strukturell nur fuer die Hauptressource gilt:
  // ein Wake&Ski-Tagesgast soll nach Ablauf der 2 Stunden nicht plotzlich
  // vom Strandbad-Drehkreuz abgewiesen werden - das Strandbad ist als
  // Tagesticket-Aequivalent konzipiert.
  const mainAreaId = ticket.accessAreaId;
  const deviceAreaIds = [device.accessIn, device.accessOut].filter(Boolean) as number[];
  const isMainResourceScan =
    mainAreaId == null || deviceAreaIds.includes(mainAreaId);

  if (ticket.startDate) {
    const start = new Date(ticket.startDate);
    start.setUTCHours(0, 0, 0, 0);
    if (now < start) {
      await db.scan.create({
        data: { code, deviceId, result: "DENIED", note: "not_yet_valid", ticketId: ticket.id, accountId },
      });
      return NextResponse.json({ granted: false, message: "Ticket noch nicht gültig", ticket: ticketInfo });
    }
  }
  if (ticket.endDate) {
    const end = new Date(ticket.endDate);
    end.setUTCHours(23, 59, 59, 999);
    if (now > end) {
      await db.scan.create({
        data: { code, deviceId, result: "DENIED", note: "expired", ticketId: ticket.id, accountId },
      });
      return NextResponse.json({ granted: false, message: "Ticket abgelaufen", ticket: ticketInfo });
    }
  }

  // TIME_SLOT-Fenster gilt nur fuer Eintritte. Beim Ausgang darf der
  // Gast immer raus, solange das Ticket grundsaetzlich gueltig ist.
  if (!isExitScan && vType === "TIME_SLOT" && ticket.slotStart && ticket.slotEnd) {
    const berlinNow = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Berlin" }));
    const currentMinutes = berlinNow.getHours() * 60 + berlinNow.getMinutes();
    const [sh, sm] = ticket.slotStart.split(":").map(Number);
    const [eh, em] = ticket.slotEnd.split(":").map(Number);
    const slotStartMin = sh * 60 + sm;
    const slotEndMin = eh * 60 + em;
    if (currentMinutes < slotStartMin || currentMinutes > slotEndMin) {
      await db.scan.create({
        data: { code, deviceId, result: "DENIED", note: "slot_window", ticketId: ticket.id, accountId },
      });
      return NextResponse.json({
        granted: false,
        message: `Einlass ${ticket.slotStart}–${ticket.slotEnd} Uhr`,
        ticket: ticketInfo,
      });
    }
  }

  // DURATION-Ablauf greift nur bei Eintritten an der HAUPTRESSOURCE. Wer
  // drin ist, darf raus, auch wenn die gebuchte Stunde inzwischen abgelaufen
  // ist. Transit-Scans an Nebenressourcen (z.B. Strandbad-Drehkreuz fuer
  // ein "Oeffentlicher Betrieb 2h"-Ticket mit Hauptressource Seilbahn A)
  // werden hier ignoriert: Nach Ablauf der 2 Stunden Wasserski darf der
  // Tagesgast trotzdem weiter im Strandbad bleiben - die Hauptressource
  // (Seilbahn A) wird oben durch `isMainResourceScan` blockiert.
  if (!isExitScan && isMainResourceScan && vType === "DURATION" && ticket.validityDurationMinutes) {
    if (ticket.firstScanAt) {
      const expiresAt = new Date(ticket.firstScanAt.getTime() + ticket.validityDurationMinutes * 60_000);
      if (now > expiresAt) {
        await db.scan.create({
          data: { code, deviceId, result: "DENIED", note: "duration_expired", ticketId: ticket.id, accountId },
        });
        return NextResponse.json({ granted: false, message: "Zeitgültigkeit abgelaufen", ticket: ticketInfo });
      }
    }
  }

  // Mitarbeiter-Wochenplan: gleiche Konvention wie TIME_SLOT - nur bei
  // Eintritten relevant. Wer drin ist, darf raus.
  if (!isExitScan) {
    const weekCheck = isWithinSchedule(ticket.weekSchedule, now);
    if (weekCheck && !weekCheck.ok) {
      await db.scan.create({
        data: { code, deviceId, result: "DENIED", note: "week_schedule", ticketId: ticket.id, accountId },
      });
      return NextResponse.json({
        granted: false,
        message: weekCheck.reason ?? "Ausserhalb der freigegebenen Zeit",
        ticket: ticketInfo,
      });
    }
  }

  const isEmployee = ticket.source === "EMP_CONTROL";

  // Direkt-Geraete-Match (additiv zu Bereichen): Wenn das Ticket fuer dieses
  // konkrete Geraet whitelisted ist, ueberspringen wir die Bereichs-Pruefung.
  const directDeviceIds = ticket.ticketDevices?.map((td) => td.deviceId) ?? [];
  const hasDirectDeviceMatch = directDeviceIds.includes(deviceId);

  if (!hasDirectDeviceMatch && (device.accessIn || device.accessOut)) {
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
        data: { code, deviceId, result: "DENIED", note: "wrong_resource", ticketId: ticket.id, accountId },
      });
      return NextResponse.json({ granted: false, message: "Resource nicht erlaubt", ticket: ticketInfo });
    }
  }

  // Exit-Scan-Definition: bereits oben berechnet, weil zeitbasierte
  // Eintritts-Schranken (TIME_SLOT, DURATION) nur fuer Eintritte gelten
  // duerfen. Definition (defensiv):
  // 1) Wenn der Pi/Drehkreuz eine explizite Richtung mitschickt, gilt die.
  // 2) Sonst nur dann Exit, wenn das Geraet AUSSCHLIESSLICH Exit ist
  //    (`accessOut != null` und `accessIn == null`). Bei bidirektional
  //    konfigurierten Geraeten ist die Richtung nicht eindeutig - wir
  //    behandeln den Scan dann defensiv als Eintritt.
  const serviceAllowsReentry = ticket.service?.allowReentry === true;

  // DURATION-Tickets: Solange der Timer (firstScanAt + duration) noch
  // laeuft, ist Reentry implizit Teil des Konzepts ("60 Minuten Seilbahn")
  // und braucht weder `service.allowReentry` noch `device.allowReentry`.
  // Erst nach Ablauf der Zeit greift die DURATION-Ablauf-Pruefung weiter
  // oben und blockt zuverlaessig.
  const durationStillRunning =
    vType === "DURATION"
    && !!ticket.validityDurationMinutes
    && !!ticket.firstScanAt
    && now.getTime() <= ticket.firstScanAt.getTime() + ticket.validityDurationMinutes * 60_000;

  // Reentry-Check: GLOBAL pro Ticket, nicht pro Device. Greift fuer
  // JEDEN Nicht-Exit-Scan (Eingang + bidirektionale/mehrdeutige
  // Geraete ohne explizite IN-Direction).
  //
  // Transit-Scans an Nebenressourcen sind hier ausgenommen: ein
  // Wake&Ski-Tagesgast, der nach der Stunde durchs Strandbad zurueckgeht
  // und spaeter nochmal durchs Strandbad reinkommt, soll dadurch nicht
  // gesperrt werden. Geblockt wird nur an der Hauptressource.
  if (!isEmployee && !isExitScan && ticket.status === "REDEEMED" && isMainResourceScan) {
    if (!serviceAllowsReentry && !device.allowReentry && !durationStillRunning) {
      await db.scan.create({
        data: { code, deviceId, result: "DENIED", note: "ticket_already_redeemed", ticketId: ticket.id, accountId },
      });
      return NextResponse.json({
        granted: false,
        message: "Ticket bereits eingelöst",
        ticket: ticketInfo,
      });
    }

    // Reentry erlaubt: Eintritt nur, wenn der letzte GRANTED-Scan an der
    // Hauptressource ein klar erkennbarer Exit war. Transit-Scans an
    // Nebenressourcen werden ignoriert, weil sie den Einloese-Zustand
    // an der Hauptressource nicht ueberschreiben sollen.
    //
    // Bei DURATION-Tickets, deren Timer noch laeuft, ueberspringen wir
    // diesen Block: Innerhalb der gebuchten Stunde darf der Gast beliebig
    // ein-/ausgehen, auch wenn das Drehkreuz keinen sauberen Exit-Scan
    // gesehen hat (z.B. Ausgang offen / nicht gescannt).
    //
    // Wenn der SERVICE Reentry explizit erlaubt (z.B. Strandbad-
    // Tageskarte), ueberspringen wir den lastWasExit-Check ebenfalls:
    // Strandbad-Gaeste verlassen das Gelaende typischerweise ohne
    // Ausgangs-Drehkreuz zu nutzen (an manchen Anlagen gibt es gar
    // keinen reinen Exit-Scanner). Ohne diese Ausnahme wuerden alle
    // Wiedereintritte als `no_exit_registered` geblockt - exakt das
    // Verhalten, das den Reentry-Service-Flag nutzlos macht.
    // Bei `device.allowReentry=true` ohne service-seitige Freigabe
    // bleibt der Exit-Check aktiv (geraetelokales Eintritt/Austritt-
    // Tracking).
    if (!durationStillRunning && !serviceAllowsReentry) {
      const mainResourceDeviceFilter = mainAreaId != null
        ? { device: { OR: [{ accessIn: mainAreaId }, { accessOut: mainAreaId }] } }
        : {};
      const lastScan = await db.scan.findFirst({
        where: { ticketId: ticket.id, result: "GRANTED", ...mainResourceDeviceFilter },
        orderBy: { scanTime: "desc" },
        select: {
          device: { select: { accessIn: true, accessOut: true } },
        },
      });
      const lastDev = lastScan?.device;
      const lastWasExit =
        !!lastDev
        && lastDev.accessOut != null
        && lastDev.accessIn == null;
      if (!lastWasExit) {
        await db.scan.create({
          data: { code, deviceId, result: "DENIED", note: "no_exit_registered", ticketId: ticket.id, accountId },
        });
        return NextResponse.json({
          granted: false,
          message: "Bereits drin (kein Ausgang registriert)",
          ticket: ticketInfo,
        });
      }
    }
  }

  // Wenn ein Ticket noch VALID ist, aber das aktuelle Device explizit
  // "kein Reentry" konfiguriert hat UND es bereits einen GRANTED-Scan an
  // diesem Ticket gibt, blockieren wir auch das (Schutzhuelle fuer
  // ungewohnliche Konfigurationen, in denen der Statuswechsel oben
  // ausnahmsweise nicht greift).
  // Abo-Tickets (subscriptionId != null) sind absichtlich ausgenommen:
  // Saisonabos sind dafuer da, beliebig oft genutzt zu werden, und der
  // Status bleibt bei ihnen dauerhaft VALID. Wuerden wir hier blockieren,
  // koenne ein Abonnent nach dem allerersten Scan nirgends ohne
  // Mehrfachzugang-Geraet mehr rein.
  //
  // Transit-Scans an Nebenressourcen werden auch hier ignoriert: der
  // Tagesgast, der erst durchs Strandbad-Drehkreuz musste, soll an der
  // Hauptressource (Seilbahn A) trotzdem als "noch nicht eingeloest"
  // gelten.
  if (
    !device.allowReentry
    && !isEmployee
    && !isExitScan
    && ticket.subscriptionId == null
    && isMainResourceScan
    && !durationStillRunning
  ) {
    const mainResourceDeviceFilter = mainAreaId != null
      ? { device: { OR: [{ accessIn: mainAreaId }, { accessOut: mainAreaId }] } }
      : {};
    const existingScan = await db.scan.findFirst({
      where: { ticketId: ticket.id, result: "GRANTED", ...mainResourceDeviceFilter },
      select: { id: true },
    });
    if (existingScan && !serviceAllowsReentry) {
      await db.scan.create({
        data: { code, deviceId, result: "DENIED", note: "no_reentry", ticketId: ticket.id, accountId },
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
  // Status- und Timer-Aenderungen passieren ausschliesslich an der
  // Hauptressource. Transit-Scans an Nebenressourcen werden zwar
  // protokolliert (GRANTED), aber sie loesen kein Redeem und kein
  // VALID-Reset aus - damit die DURATION beim Tagesgast nicht schon am
  // Strandbad startet, sondern erst an der Seilbahn.
  const shouldRedeem =
    ticket.status === "VALID"
    && !isEmployee
    && ticket.subscriptionId == null
    && isMainResourceScan;
  const shouldResetValid =
    ticket.status === "REDEEMED"
    && isExitScan
    && !!ticket.service?.allowReentry
    && isMainResourceScan;

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
      data: { code, deviceId, result: "DENIED", note: "race_conflict", ticketId: ticket.id, accountId },
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
