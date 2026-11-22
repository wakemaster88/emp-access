/**
 * Verkauf mit einem Klick aus dem Kundenfenster (Bändchen am Kunden).
 *
 * Baut dieselbe Anfrage wie „Ticket erstellen“ (add-ticket-overlay.tsx) für
 * einen Service ohne eigene Eingaben: Service-Vorgaben, gültig heute,
 * Hauptressource als Bereich. Kurse und anny-Slots brauchen die Slot-Auswahl
 * und gehen weiter über das Formular.
 */
import type { ServiceData } from "./checkin-types";
import { isCourseSlotService } from "./add-ticket-overlay";

/** Geht der Service ohne Formular (kein Kurs, keine anny-Slots)? */
export function canQuickSell(svc: ServiceData): boolean {
  if (isCourseSlotService(svc)) return false;
  if (svc.hasAnnyLink && svc.defaultValidityType !== "DURATION") return false;
  return true;
}

/** Kurzer Name für die Taste: „Öffentlicher Betrieb - 2 Stunden“ → „2 Stunden“. */
export function shortServiceName(name: string): string {
  const parts = name.split(/\s[-–]\s/).map((p) => p.trim()).filter(Boolean);
  const last = parts[parts.length - 1] ?? name;
  return last.length >= 3 ? last : name;
}

function localDay(d: Date, end: boolean): Date {
  return end
    ? new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
    : new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

export interface QuickSaleInput {
  code: string | null;
  personId: number | null;
  firstName?: string | null;
  lastName?: string | null;
  now?: Date;
}

export function quickSalePayload(svc: ServiceData, input: QuickSaleInput): Record<string, unknown> {
  const now = input.now ?? new Date();
  const firstName = input.firstName?.trim() || "";
  const lastName = input.lastName?.trim() || "";
  const payload: Record<string, unknown> = {
    name: `${firstName} ${lastName}`.trim() || svc.name || "Ticket",
    status: "VALID",
    serviceId: svc.id,
    ticketTypeName: svc.name,
  };
  if (firstName) payload.firstName = firstName;
  if (lastName) payload.lastName = lastName;
  if (input.personId != null) payload.personId = input.personId;

  if (svc.defaultValidityType) {
    payload.validityType = svc.defaultValidityType;
    if (svc.defaultValidityType === "TIME_SLOT") {
      if (svc.defaultSlotStart) payload.slotStart = svc.defaultSlotStart;
      if (svc.defaultSlotEnd) payload.slotEnd = svc.defaultSlotEnd;
    } else if (svc.defaultValidityType === "DURATION" && svc.defaultValidityDurationMinutes != null) {
      payload.validityDurationMinutes = svc.defaultValidityDurationMinutes;
    }
  }
  if (payload.slotStart == null && svc.defaultSlotStart && svc.defaultSlotEnd) {
    payload.slotStart = svc.defaultSlotStart;
    payload.slotEnd = svc.defaultSlotEnd;
  }
  if (input.code) {
    payload.barcode = input.code;
    payload.qrCode = input.code;
    payload.rfidCode = input.code;
  }
  const mainId = svc.mainAccessAreaId ?? svc.areaIds?.[0] ?? null;
  if (mainId != null) payload.accessAreaId = mainId;

  const isDuration = payload.validityType === "DURATION";
  const start = svc.defaultStartDate && !isDuration ? new Date(svc.defaultStartDate) : now;
  const startDay = localDay(isNaN(start.getTime()) ? now : start, false);
  payload.startDate = startDay.toISOString();
  if (!isDuration) {
    const end = svc.defaultEndDate ? new Date(svc.defaultEndDate) : startDay;
    const endDay = localDay(isNaN(end.getTime()) || end < startDay ? startDay : end, true);
    payload.endDate = endDay.toISOString();
  }
  if (!payload.validityType) payload.validityType = "DATE_RANGE";
  return payload;
}
