/**
 * Bulk-Erstellung von Tickets – gemeinsame Logik fuer beide Aufrufer:
 *
 *  - Dashboard `/api/tickets/bulk` (Session-Auth)
 *  - Shop-Monitor `/api/checkin/public/[token]/tickets/bulk` (Monitor-Token)
 *
 * Zwei Betriebsarten in einer Funktion:
 *
 *  - PRINT: `count` Tickets mit auto-generiertem, eindeutigem Barcode + QR
 *    fuer den Bondrucker.
 *  - RFID:  ein Ticket je gescanntem Baendchen-Code, ohne Barcode/QR.
 *
 * Alle Tickets eines Aufrufs teilen sich eine `bulkBatchId`, damit ein Bulk
 * spaeter als Ganzes gelistet und erneut gedruckt werden kann.
 *
 * Die Funktion gibt Fehler als Ergebnis zurueck statt zu werfen, damit beide
 * Routen denselben Statuscode und dieselbe Fehlerstruktur ausliefern – das
 * Frontend wertet u. a. `error.code === "CODE_CONFLICT"` aus.
 */

import type { z } from "zod";
import type { TenantDb } from "@/lib/prisma";
import type { ticketBulkCreateSchema } from "./validators";

type Db = TenantDb;

export type TicketBulkInput = z.infer<typeof ticketBulkCreateSchema>;

export interface BulkCreatedTicket {
  id: number;
  name: string;
  barcode: string;
  qrCode: string | null;
  rfidCode: string | null;
  ticketTypeName: string | null;
  startDate: string | null;
  endDate: string | null;
  slotStart: string | null;
  slotEnd: string | null;
  accessAreaId: number | null;
  accessAreaName: string | null;
  validityType: string;
  validityDurationMinutes: number | null;
}

export type TicketBulkResult =
  | {
      ok: true;
      tickets: BulkCreatedTicket[];
      bulkBatchId: string;
      kind: "PRINT" | "RFID";
    }
  | { ok: false; status: number; body: Record<string, unknown> };

function randomUuid(): string {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

function randomCode(prefix: string): string {
  const compact = randomUuid().replace(/-/g, "").slice(0, 8).toUpperCase();
  return `${prefix}-${compact}`;
}

function formError(message: string, status = 400): TicketBulkResult {
  return { ok: false, status, body: { error: { formErrors: [message] } } };
}

export async function createTicketBulk(
  db: Db,
  accountId: number,
  data: TicketBulkInput,
): Promise<TicketBulkResult> {
  const codePrefix = (data.codePrefix ?? "BLK").toUpperCase();
  const namePrefix = data.namePrefix?.trim() || "Ticket";
  const bulkBatchId = randomUuid();

  // RFID-Modus: ein Ticket pro gescanntem Code, kein Barcode/QR, kein Druck.
  // Doppelte Eingaben innerhalb des Batches werden hier dedupliziert
  // (Whitespace-getrimmt). count ergibt sich daraus.
  const rfidCodes: string[] = [];
  const isRfidMode = Array.isArray(data.rfidCodes) && data.rfidCodes.length > 0;
  if (isRfidMode) {
    const seen = new Set<string>();
    for (const c of data.rfidCodes!) {
      const trimmed = c.trim();
      if (!trimmed) continue;
      if (seen.has(trimmed)) continue;
      seen.add(trimmed);
      rfidCodes.push(trimmed);
    }
    if (rfidCodes.length === 0) {
      return formError("Keine gueltigen RFID-Codes uebergeben.");
    }
  }

  const totalCount = isRfidMode ? rfidCodes.length : data.count!;

  // Zugehoerigkeit der referenzierten Datensaetze pruefen. Ueber den
  // Monitor-Token ist das die einzige Stelle, an der eine fremde Service-
  // oder Bereichs-ID auffallen wuerde – ohne Pruefung haetten die Tickets
  // sonst eine Verknuepfung in einen anderen Mandanten.
  if (data.serviceId) {
    const svc = await db.service.findFirst({
      where: { id: data.serviceId, accountId },
      select: { id: true },
    });
    if (!svc) return formError("Der gewaehlte Ticket-Typ gehoert nicht zu diesem Mandanten.");
  }
  if (data.subscriptionId) {
    const sub = await db.subscription.findFirst({
      where: { id: data.subscriptionId, accountId },
      select: { id: true },
    });
    if (!sub) return formError("Das gewaehlte Abo gehoert nicht zu diesem Mandanten.");
  }

  // Bei RFID-Mode pruefen wir vorab, ob einer der Codes schon einem Ticket
  // im Account zugeordnet ist (rfidCode/qrCode/barcode). So vermeiden wir
  // halb-erstellte Bulks bei Konflikten.
  if (isRfidMode) {
    const conflicts = await db.ticket.findMany({
      where: {
        accountId,
        OR: [
          { rfidCode: { in: rfidCodes } },
          { qrCode: { in: rfidCodes } },
          { barcode: { in: rfidCodes } },
        ],
      },
      select: {
        id: true,
        name: true,
        rfidCode: true,
        qrCode: true,
        barcode: true,
        ticketTypeName: true,
      },
    });
    if (conflicts.length > 0) {
      const conflictCodes = new Set<string>();
      const conflictTickets = conflicts.map((c) => {
        const hit =
          (c.rfidCode && rfidCodes.includes(c.rfidCode) && c.rfidCode) ||
          (c.qrCode && rfidCodes.includes(c.qrCode) && c.qrCode) ||
          (c.barcode && rfidCodes.includes(c.barcode) && c.barcode) ||
          "";
        if (hit) conflictCodes.add(hit);
        return {
          id: c.id,
          name: c.name,
          ticketTypeName: c.ticketTypeName,
          code: hit,
        };
      });
      const codesList = [...conflictCodes].slice(0, 5).join(", ");
      const more =
        conflictCodes.size > 5 ? ` (+${conflictCodes.size - 5} weitere)` : "";
      return {
        ok: false,
        status: 409,
        body: {
          error: {
            formErrors: [
              `${conflictCodes.size} RFID-Code(s) sind bereits anderen Tickets zugeordnet: ${codesList}${more}.`,
            ],
            code: "CODE_CONFLICT",
            conflictCodes: [...conflictCodes],
            conflictTickets,
          },
        },
      };
    }
  }

  let serviceAreaIds: number[] = [];
  if (data.serviceId) {
    const svcAreas = await db.serviceArea.findMany({
      where: { serviceId: data.serviceId },
      select: { accessAreaId: true },
    });
    serviceAreaIds = svcAreas.map((sa: { accessAreaId: number }) => sa.accessAreaId);
  }

  const startDate = data.startDate ? new Date(data.startDate) : undefined;
  const endDate = data.endDate ? new Date(data.endDate) : undefined;

  let accessAreaName: string | null = null;
  if (data.accessAreaId) {
    const area = await db.accessArea.findFirst({
      where: { id: data.accessAreaId, accountId },
      select: { name: true },
    });
    if (!area) return formError("Der gewaehlte Bereich gehoert nicht zu diesem Mandanten.");
    accessAreaName = area.name;
  }

  const created: BulkCreatedTicket[] = [];

  for (let i = 0; i < totalCount; i++) {
    const rfid = isRfidMode ? rfidCodes[i] : null;
    // RFID-Bulk: Name = "Praefix CODE" (z. B. "Baendchen ABC123"), wie vom
    // Nutzer gewuenscht. Kein Auto-Counter, weil der Code als Identifier
    // schon eindeutig ist.
    const fallbackName = isRfidMode
      ? `${namePrefix} ${rfid}`
      : `${namePrefix} ${i + 1}`;
    const name = data.names?.[i]?.trim() || fallbackName;

    let attempts = 0;
    let inserted: Awaited<ReturnType<typeof db.ticket.create>> | null = null;
    while (attempts < 5 && inserted == null) {
      attempts++;
      try {
        inserted = await db.ticket.create({
          data: {
            name,
            // PRINT-Bulk: zufaelliger eindeutiger Barcode + QR.
            // RFID-Bulk: kein Barcode/QR, dafuer rfidCode.
            ...(isRfidMode
              ? { rfidCode: rfid }
              : (() => {
                  const code = randomCode(codePrefix);
                  return { barcode: code, qrCode: code };
                })()),
            startDate,
            endDate,
            accessAreaId: data.accessAreaId ?? undefined,
            subscriptionId: data.subscriptionId ?? undefined,
            serviceId: data.serviceId ?? undefined,
            status: "VALID",
            ticketTypeName: data.ticketTypeName ?? undefined,
            validityType: data.validityType ?? "DATE_RANGE",
            slotStart: data.slotStart ?? undefined,
            slotEnd: data.slotEnd ?? undefined,
            validityDurationMinutes: data.validityDurationMinutes ?? undefined,
            bulkBatchId,
            accountId,
            ...(serviceAreaIds.length > 0
              ? {
                  ticketAreas: {
                    create: serviceAreaIds.map((areaId) => ({ accessAreaId: areaId })),
                  },
                }
              : {}),
          },
        });
      } catch (e) {
        // Unique-Konflikt → in PRINT-Mode erneut versuchen mit neuem Code.
        // In RFID-Mode hatten wir den Konflikt vorab gecheckt; falls hier
        // doch noch einer auftritt (Race), abbrechen statt endlos retryen.
        const msg = e instanceof Error ? e.message : "";
        const isUnique = msg.includes("Unique") || msg.includes("unique");
        if (!isUnique) throw e;
        if (isRfidMode) {
          return {
            ok: false,
            status: 409,
            body: {
              error: {
                formErrors: [
                  `RFID-Code "${rfid}" wurde zwischenzeitlich vergeben. Bitte erneut versuchen.`,
                ],
                code: "CODE_CONFLICT",
                conflictCodes: [rfid],
              },
              createdCount: created.length,
            },
          };
        }
      }
    }

    if (!inserted) {
      return {
        ok: false,
        status: 500,
        body: {
          error: "Bulk-Erstellung fehlgeschlagen: Konnten keine eindeutigen Codes erzeugen.",
          createdCount: created.length,
        },
      };
    }

    created.push({
      id: inserted.id,
      name: inserted.name,
      barcode: inserted.barcode ?? "",
      qrCode: inserted.qrCode,
      rfidCode: inserted.rfidCode,
      ticketTypeName: inserted.ticketTypeName,
      startDate: inserted.startDate?.toISOString() ?? null,
      endDate: inserted.endDate?.toISOString() ?? null,
      slotStart: inserted.slotStart,
      slotEnd: inserted.slotEnd,
      accessAreaId: inserted.accessAreaId,
      accessAreaName,
      validityType: inserted.validityType,
      validityDurationMinutes: inserted.validityDurationMinutes,
    });
  }

  return {
    ok: true,
    tickets: created,
    bulkBatchId,
    kind: isRfidMode ? "RFID" : "PRINT",
  };
}
