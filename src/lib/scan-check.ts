import { prisma } from "@/lib/prisma";
import type { PrismaClient } from "@prisma/client";
import { isWithinSchedule } from "@/lib/schedule";

/**
 * Geteilte Scan-Check-Kernlogik fuer den authentifizierten Endpoint
 * (`/api/scan-check`) und den oeffentlichen Token-Scanner
 * (`/api/scanner/public/[token]/scan-check`).
 *
 * Die Funktion ist account-scoped: Der Aufrufer ist verantwortlich,
 * accountId entweder aus der Session oder aus einem oeffentlichen
 * Monitor-Token aufzuloesen.
 */

export interface ScanCheckTicketInfo {
  name: string;
  firstName: string | null;
  lastName: string | null;
  ticketTypeName: string | null;
  status: string;
  areaName: string | null;
  serviceName: string | null;
  subscriptionName: string | null;
  vereinName: string | null;
}

export interface ScanCheckResult {
  granted: boolean;
  message: string;
  ticket?: ScanCheckTicketInfo;
}

export interface PerformScanCheckArgs {
  /** RLS-aware Prisma client (z. B. aus getSessionWithDb) */
  db: PrismaClient;
  accountId: number;
  code: string;
  /** Optional: Auf eine bestimmte Area beschraenken */
  accessAreaId?: number;
  /** Optional: deviceId fuer den geschriebenen Scan */
  deviceId?: number | null;
}

/**
 * Prueft, ob ein Verein-Zutritts-Ticket aktuell gueltig ist (Status + Zeitraum
 * des Tickets selbst). Nur dann duerfen seine Areas an Vereinsmitglieder
 * vererbt werden. Restriktionen kommen direkt vom Ticket (DATE_RANGE,
 * TIME_SLOT, DURATION).
 */
function isAccessTicketCurrentlyValid(
  t: {
    status: string;
    startDate: Date | null;
    endDate: Date | null;
    validityType: string | null;
    slotStart: string | null;
    slotEnd: string | null;
    validityDurationMinutes: number | null;
    firstScanAt: Date | null;
  },
  now: Date,
): boolean {
  if (t.status !== "VALID" && t.status !== "REDEEMED") return false;

  if (t.startDate) {
    const start = new Date(t.startDate);
    start.setUTCHours(0, 0, 0, 0);
    if (now < start) return false;
  }
  if (t.endDate) {
    const end = new Date(t.endDate);
    end.setUTCHours(23, 59, 59, 999);
    if (now > end) return false;
  }

  const vType = t.validityType ?? "DATE_RANGE";
  if (vType === "TIME_SLOT" && t.slotStart && t.slotEnd) {
    const berlinNow = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Berlin" }));
    const minutes = berlinNow.getHours() * 60 + berlinNow.getMinutes();
    const [sh, sm] = t.slotStart.split(":").map(Number);
    const [eh, em] = t.slotEnd.split(":").map(Number);
    if (minutes < sh * 60 + sm || minutes > eh * 60 + em) return false;
  }
  if (vType === "DURATION" && t.validityDurationMinutes && t.firstScanAt) {
    const expiresAt = new Date(t.firstScanAt.getTime() + t.validityDurationMinutes * 60_000);
    if (now > expiresAt) return false;
  }

  return true;
}

export async function performScanCheck({
  db,
  accountId,
  code: rawInput,
  accessAreaId,
  deviceId,
}: PerformScanCheckArgs): Promise<ScanCheckResult> {
  const rawCode = String(rawInput ?? "").trim();
  const code = rawCode.replace(/\s+/g, "");
  const scanDeviceData = deviceId ? { deviceId } : {};

  if (!code) {
    return { granted: false, message: "Kein Code erkannt" };
  }

  const codesToTry = [code, rawCode];
  type TicketWithRels = Awaited<ReturnType<typeof loadCandidates>>[number];
  let ticket: TicketWithRels | null = null;

  async function loadCandidates(c: string) {
    return db.ticket.findMany({
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
        accessArea: { select: { name: true } },
        ticketAreas: { select: { accessAreaId: true } },
        ticketDevices: { select: { deviceId: true } },
        verein: {
          select: {
            name: true,
            accessTickets: {
              select: {
                ticket: {
                  select: {
                    id: true,
                    status: true,
                    startDate: true,
                    endDate: true,
                    validityType: true,
                    slotStart: true,
                    slotEnd: true,
                    validityDurationMinutes: true,
                    firstScanAt: true,
                    accessAreaId: true,
                    ticketAreas: { select: { accessAreaId: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
  }

  for (const c of codesToTry) {
    const candidates = await loadCandidates(c);
    if (candidates.length > 0) {
      const now = new Date();
      function ticketScore(t: TicketWithRels): number {
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
    // Gutschein-Einloesung: Code beginnt mit "GS-"
    if (code.startsWith("GS-")) {
      const voucher = await db.voucher.findUnique({ where: { code, accountId } });
      if (voucher && !voucher.redeemedAt) {
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        const todayEnd = new Date(today);
        todayEnd.setUTCHours(23, 59, 59, 999);

        const redeemed = await prisma
          .$transaction(async (tx) => {
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
              throw new Error("VOUCHER_ALREADY_REDEEMED");
            }

            await tx.scan.create({
              data: { code, result: "GRANTED", ticketId: newTicket.id, accountId, ...scanDeviceData },
            });

            return newTicket;
          })
          .catch((e) => {
            if (e instanceof Error && e.message === "VOUCHER_ALREADY_REDEEMED") {
              return null;
            }
            throw e;
          });

        if (!redeemed) {
          await db.scan.create({
            data: { code, result: "DENIED", accountId, ...scanDeviceData },
          });
          return { granted: false, message: "Gutschein bereits eingelöst" };
        }

        return {
          granted: true,
          message: "Gutschein eingelöst",
          ticket: {
            name: redeemed.name,
            firstName: null,
            lastName: null,
            ticketTypeName: redeemed.ticketTypeName,
            status: redeemed.status,
            areaName: null,
            serviceName: null,
            subscriptionName: null,
            vereinName: null,
          },
        };
      }

      if (voucher?.redeemedAt) {
        await db.scan.create({
          data: { code, result: "DENIED", accountId, ...scanDeviceData },
        });
        return { granted: false, message: "Gutschein bereits eingelöst" };
      }
    }

    await db.scan.create({
      data: { code, result: "DENIED", accountId, ...scanDeviceData },
    });
    return { granted: false, message: "Ticket nicht gefunden" };
  }

  const ticketInfo: ScanCheckTicketInfo = {
    name: ticket.name,
    firstName: ticket.firstName,
    lastName: ticket.lastName,
    ticketTypeName: ticket.ticketTypeName,
    status: ticket.status,
    areaName: ticket.accessArea?.name ?? null,
    serviceName: ticket.service?.name ?? null,
    subscriptionName: ticket.subscription?.name ?? null,
    vereinName: ticket.verein?.name ?? null,
  };

  if (ticket.status === "INVALID") {
    await db.scan.create({
      data: { code, result: "DENIED", ticketId: ticket.id, accountId, ...scanDeviceData },
    });
    return { granted: false, message: "Ticket ungültig", ticket: ticketInfo };
  }

  if (ticket.status === "PAUSED") {
    await db.scan.create({
      data: { code, result: "DENIED", ticketId: ticket.id, accountId, ...scanDeviceData },
    });
    return { granted: false, message: "Abo pausiert", ticket: ticketInfo };
  }

  if (ticket.status === "CANCELED") {
    await db.scan.create({
      data: { code, result: "DENIED", ticketId: ticket.id, accountId, ...scanDeviceData },
    });
    return { granted: false, message: "Ticket storniert", ticket: ticketInfo };
  }

  if (ticket.status === "PROTECTED") {
    await db.scan.create({
      data: { code, result: "PROTECTED", ticketId: ticket.id, accountId, ...scanDeviceData },
    });
    return { granted: false, message: "Ticket gesperrt", ticket: ticketInfo };
  }

  const now = new Date();
  const vType = ticket.validityType ?? "DATE_RANGE";

  if (ticket.startDate) {
    const start = new Date(ticket.startDate);
    start.setUTCHours(0, 0, 0, 0);
    if (now < start) {
      await db.scan.create({
        data: { code, result: "DENIED", ticketId: ticket.id, accountId, ...scanDeviceData },
      });
      return { granted: false, message: "Ticket noch nicht gültig", ticket: ticketInfo };
    }
  }

  if (ticket.endDate) {
    const end = new Date(ticket.endDate);
    end.setUTCHours(23, 59, 59, 999);
    if (now > end) {
      await db.scan.create({
        data: { code, result: "DENIED", ticketId: ticket.id, accountId, ...scanDeviceData },
      });
      return { granted: false, message: "Ticket abgelaufen", ticket: ticketInfo };
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
        data: { code, result: "DENIED", ticketId: ticket.id, accountId, ...scanDeviceData },
      });
      return {
        granted: false,
        message: `Zeitslot ${ticket.slotStart}–${ticket.slotEnd} Uhr`,
        ticket: ticketInfo,
      };
    }
  }

  if (vType === "DURATION" && ticket.validityDurationMinutes) {
    if (ticket.firstScanAt) {
      const expiresAt = new Date(ticket.firstScanAt.getTime() + ticket.validityDurationMinutes * 60_000);
      if (now > expiresAt) {
        await db.scan.create({
          data: { code, result: "DENIED", ticketId: ticket.id, accountId, ...scanDeviceData },
        });
        return { granted: false, message: "Zeitgültigkeit abgelaufen", ticket: ticketInfo };
      }
    }
  }

  // Mitarbeiter-Wochenplan: wenn gesetzt, muss aktuelle Berliner Zeit am
  // entsprechenden Wochentag im freigegebenen Fenster liegen.
  const weekCheck = isWithinSchedule(ticket.weekSchedule, now);
  if (weekCheck && !weekCheck.ok) {
    await db.scan.create({
      data: { code, result: "DENIED", ticketId: ticket.id, accountId, ...scanDeviceData },
    });
    return {
      granted: false,
      message: weekCheck.reason ?? "Ausserhalb der freigegebenen Zeit",
      ticket: ticketInfo,
    };
  }

  const isEmployee = ticket.source === "EMP_CONTROL";

  // Direkt-Geraete-Zuweisung (additiv zu Bereichen): Wenn der Scan an einem
  // konkret zugewiesenen Geraet stattfindet, ist die Bereichs-Pruefung
  // uebersprungen.
  const directDeviceIds = ticket.ticketDevices?.map((td) => td.deviceId) ?? [];
  const hasDirectDeviceMatch = !!deviceId && directDeviceIds.includes(deviceId);

  if (accessAreaId && !hasDirectDeviceMatch) {
    const ticketAreaIds = ticket.ticketAreas?.map((ta) => ta.accessAreaId) ?? [];
    const vereinAreaIds: number[] = [];
    for (const at of ticket.verein?.accessTickets ?? []) {
      if (!isAccessTicketCurrentlyValid(at.ticket, now)) continue;
      if (at.ticket.accessAreaId) vereinAreaIds.push(at.ticket.accessAreaId);
      for (const ta of at.ticket.ticketAreas) vereinAreaIds.push(ta.accessAreaId);
    }
    const subscriptionAreaIds = ticket.subscription?.areas?.map((a) => a.id) ?? [];
    const serviceAreaIds = ticket.service?.serviceAreas?.map((sa) => sa.accessAreaId) ?? [];
    const allTicketAreas = [
      ...(ticket.accessAreaId ? [ticket.accessAreaId] : []),
      ...ticketAreaIds,
      ...subscriptionAreaIds,
      ...serviceAreaIds,
      ...vereinAreaIds,
    ];
    const isVereinMember = !!ticket.vereinId;
    const hasAccess = isVereinMember
      ? allTicketAreas.includes(accessAreaId)
      : allTicketAreas.length === 0 || allTicketAreas.includes(accessAreaId);
    if (!hasAccess) {
      await db.scan.create({
        data: { code, result: "DENIED", ticketId: ticket.id, accountId, ...scanDeviceData },
      });
      return { granted: false, message: "Resource nicht erlaubt", ticket: ticketInfo };
    }
  }

  // Atomar: Scan + optionale Statusaenderung in einer Transaktion mit version-Check.
  const shouldRedeem =
    ticket.status === "VALID" && !isEmployee && ticket.subscriptionId == null;

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
    }
    await tx.scan.create({
      data: { code, result: "GRANTED", ticketId: ticket.id, accountId, ...scanDeviceData },
    });
    return { conflict: false as const };
  });

  if (txResult.conflict) {
    await db.scan.create({
      data: { code, result: "DENIED", ticketId: ticket.id, accountId, ...scanDeviceData },
    });
    return {
      granted: false,
      message: "Konflikt: Ticket wurde bereits verarbeitet",
      ticket: ticketInfo,
    };
  }

  return {
    granted: true,
    message: "Zutritt gewährt",
    ticket: ticketInfo,
  };
}
