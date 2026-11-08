/**
 * Reine Regeln des Vereinsportals (ohne Datenbank), damit sie testbar sind:
 * Buchungsfenster, Storno-Frist, Slot-Zustand, Abrechnungs-Summen und CSV.
 */

import { addCalendarDays, berlinYmd } from "@/lib/berlin-day";

export type PortalSlotState = "free" | "taken" | "mine" | "past";

export interface PortalSlot {
  startTime: string;
  endTime: string;
  state: PortalSlotState;
}

/** Ab wann und bis wann darf der Verein buchen (Berlin-Tage, inklusive)? */
export function bookingWindow(horizonDays: number, now: Date = new Date()): { from: string; to: string } {
  const from = berlinYmd(now);
  return { from, to: addCalendarDays(from, Math.max(0, horizonDays)) };
}

/** Liegt der Tag im Buchungsfenster? */
export function isDateBookable(date: string, horizonDays: number, now: Date = new Date()): boolean {
  const { from, to } = bookingWindow(horizonDays, now);
  return date >= from && date <= to;
}

/** Darf der Verein selbst (kostenlos) stornieren? Bis `cancelHours` vor Beginn. */
export function canVereinCancel(startDate: Date, cancelHours: number, now: Date = new Date()): boolean {
  return startDate.getTime() - now.getTime() >= Math.max(0, cancelHours) * 3_600_000;
}

/**
 * Zustand der Slots fuer den Verein. Der Verein sieht keine Restplaetze,
 * nur frei, belegt, eigene Buchung oder vorbei.
 */
export function portalSlotStates(
  slots: { startTime: string; endTime: string; startIso?: string; available?: boolean }[],
  opts: { mine: Set<string>; blocked: Set<string>; now?: Date },
): PortalSlot[] {
  const now = opts.now ?? new Date();
  return slots
    .filter((s) => s.startTime)
    .map((s) => {
      const start = s.startIso ? new Date(s.startIso) : null;
      let state: PortalSlotState;
      if (opts.mine.has(s.startTime)) state = "mine";
      else if (start && start.getTime() <= now.getTime()) state = "past";
      else if (s.available === false || opts.blocked.has(s.startTime)) state = "taken";
      else state = "free";
      return { startTime: s.startTime, endTime: s.endTime, state };
    })
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
}

/** "45,00 €" */
export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

/** Euro-Eingabe ("45", "45,50", "45.5") in Cent; null bei Unsinn. */
export function parseEuroToCents(input: string): number | null {
  const s = input.trim().replace(/\s|€/g, "").replace(",", ".");
  if (s === "") return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

/** Erster und letzter Tag eines Monats "YYYY-MM" als YYYY-MM-DD (fuer String-Vergleich). */
export function monthBounds(ym: string): { from: string; to: string } | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return null;
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
}

export interface BillingRow {
  id: number;
  vereinName: string;
  serviceName: string;
  date: string;
  slotStart: string;
  slotEnd: string;
  priceCents: number;
  status: "BOOKED" | "CANCELED";
  bookedBy: string | null;
  billedAt: Date | string | null;
  invoiceRef: string | null;
}

/** Summen fuer die Abrechnung: nur gebuchte (nicht stornierte) Slots zaehlen. */
export function billingTotals(rows: Pick<BillingRow, "priceCents" | "status" | "billedAt">[]) {
  let openCents = 0;
  let billedCents = 0;
  let openCount = 0;
  let billedCount = 0;
  for (const r of rows) {
    if (r.status !== "BOOKED") continue;
    if (r.billedAt) {
      billedCents += r.priceCents;
      billedCount += 1;
    } else {
      openCents += r.priceCents;
      openCount += 1;
    }
  }
  return { openCents, billedCents, openCount, billedCount };
}

function csvCell(v: string): string {
  return /[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * CSV fuer die Abrechnung (Semikolon, deutsches Komma, BOM fuer Excel).
 * Enthaelt nur gebuchte Slots; Stornos werden nicht abgerechnet.
 */
export function billingCsv(rows: BillingRow[]): string {
  const head = ["Verein", "Datum", "Von", "Bis", "Service", "Preis (EUR)", "Gebucht von", "Abgerechnet am", "Rechnung"];
  const lines = rows
    .filter((r) => r.status === "BOOKED")
    .map((r) => {
      const [y, m, d] = r.date.split("-");
      const billed = r.billedAt ? berlinYmd(new Date(r.billedAt)).split("-").reverse().join(".") : "";
      return [
        r.vereinName,
        `${d}.${m}.${y}`,
        r.slotStart,
        r.slotEnd,
        r.serviceName,
        (r.priceCents / 100).toFixed(2).replace(".", ","),
        r.bookedBy ?? "",
        billed,
        r.invoiceRef ?? "",
      ].map(csvCell).join(";");
    });
  return "﻿" + [head.join(";"), ...lines].join("\r\n") + "\r\n";
}

/**
 * Zugangsfenster einer Buchung: Slot plus Vorbereitung davor und
 * Nachbereitung danach. In diesem Fenster duerfen Mitglieder durch die
 * Drehkreuze und der Verein die freigegebenen Tueren/Tore oeffnen.
 */
export function accessWindow(
  start: Date,
  end: Date,
  leadMinutes: number,
  trailMinutes: number,
): { from: Date; to: Date } {
  return {
    from: new Date(start.getTime() - Math.max(0, leadMinutes) * 60_000),
    to: new Date(end.getTime() + Math.max(0, trailMinutes) * 60_000),
  };
}

export function isInAccessWindow(
  booking: { startDate: Date; endDate: Date },
  leadMinutes: number,
  trailMinutes: number,
  now: Date = new Date(),
): boolean {
  const w = accessWindow(booking.startDate, booking.endDate, leadMinutes, trailMinutes);
  return now >= w.from && now <= w.to;
}

/** "HH:mm" in Berlin; ueber die Tagesgrenze hinaus auf 00:00 bzw. 23:59 gekappt. */
export function clampedBerlinHm(d: Date, day: string, edge: "start" | "end"): string {
  const ymd = berlinYmd(d);
  if (ymd < day) return "00:00";
  if (ymd > day) return "23:59";
  const hm = d.toLocaleTimeString("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hour12: false });
  return hm === "24:00" ? (edge === "start" ? "00:00" : "23:59") : hm;
}
