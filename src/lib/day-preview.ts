/**
 * Tagesvorschau: was steht heute (oder an einem anderen Tag) an?
 *
 * Fuer den Hub-Assistenten, der die Vorschau morgens um 7:30 per Telegram
 * schickt (GET /api/hub/day-preview). Die Buchungen kommen aus den von ANNY
 * synchronisierten Tickets, das Wetter von Open-Meteo (weather-day.ts). Das
 * Personal (Schichten aus emp-control) haengt der Hub selbst an, er hat den
 * Stand ohnehin.
 *
 * Gezaehlt werden Gaeste, nicht Tickets: Kombi-Services legen in ANNY je Gast
 * eine Buchung pro Ressource an, `bundleAnnyTickets` fasst sie zusammen.
 * Abos, Vereine, Mitarbeiter und Bulk-Baender sind keine Tagesbuchungen und
 * bleiben draussen.
 *
 * `summarizeBookings` ist rein (getestet), `loadDayPreview` liest die DB.
 */
import { bundleAnnyTickets } from "@/lib/anny-ticket-bundle";

const TZ = "Europe/Berlin";
/** Ab so vielen Gaesten in einem Auftrag gilt eine Buchung als Gruppe. */
export const GROUP_MIN_GUESTS = 5;
/** Slots ohne Ende belegen so lange. */
const DEFAULT_SLOT_MIN = 60;

export interface PreviewTicket {
  id: number;
  uuid: string | null;
  name: string;
  firstName: string | null;
  lastName: string | null;
  serviceId: number | null;
  serviceName: string | null;
  ticketTypeName: string | null;
  validityType: string;
  slotStart: string | null;
  slotEnd: string | null;
  startDate: Date | null;
  endDate: Date | null;
  annyResourceId: string | null;
  annyOrderId: string | null;
  addOns: unknown;
}

export interface DayBookings {
  /** Gaeste insgesamt. */
  guests: number;
  /** Gaeste mit fester Uhrzeit (Kurs, Bahnmiete, …). */
  slottedGuests: number;
  byService: { label: string; guests: number }[];
  /** Feste Termine nach Uhrzeit und Angebot. */
  slots: { time: string; end: string | null; label: string; guests: number }[];
  /** Stunden mit den meisten gleichzeitig gebuchten Gaesten (nur Termine mit Uhrzeit). */
  peaks: { from: string; to: string; guests: number }[];
  groups: { name: string; guests: number; label: string; time: string | null }[];
  /** Gebuchtes Verleihmaterial (je Auftrag einmal gezaehlt). */
  rentals: { name: string; quantity: number }[];
}

/* ------------------------------------------------------------- Zeit */

/** Uhrzeit "HH:MM" eines Zeitpunkts in Berlin. */
export function berlinHHMM(d: Date): string {
  return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: TZ, hour12: false });
}

/** Heutiges Datum in Berlin als YYYY-MM-DD. */
export function berlinToday(now = new Date()): string {
  return now.toLocaleDateString("sv-SE", { timeZone: TZ });
}

/** Beginn (inkl.) und Ende (exkl.) eines Berliner Kalendertags als echte UTC-Zeitpunkte. */
export function berlinDayRange(date: string): { start: Date; end: Date } {
  const [y, m, d] = date.split("-").map(Number);
  const startOf = (yy: number, mm: number, dd: number) => {
    const guess = Date.UTC(yy, mm - 1, dd);
    // Versatz Berlin↔UTC zu diesem Zeitpunkt (1 h Winter, 2 h Sommer).
    const wall = new Date(new Date(guess).toLocaleString("en-US", { timeZone: TZ }));
    const utcWall = new Date(new Date(guess).toLocaleString("en-US", { timeZone: "UTC" }));
    return new Date(guess - (wall.getTime() - utcWall.getTime()));
  };
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return { start: startOf(y, m, d), end: startOf(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()) };
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};
const fromMin = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/**
 * Feste Uhrzeit einer Buchung, wie im Telegram-Tagesbericht der Cloud:
 * slotStart, TIME_SLOT mit startDate oder ein kurzes DATE_RANGE (≤ 4 h).
 * Tageskarten und DURATION-Tickets haben keine feste Uhrzeit.
 */
export function bookingWindow(t: PreviewTicket): { start: string; end: string | null } | null {
  if (t.slotStart) return { start: t.slotStart, end: t.slotEnd };
  if (t.validityType === "TIME_SLOT" && t.startDate) {
    return { start: berlinHHMM(t.startDate), end: t.endDate ? berlinHHMM(t.endDate) : null };
  }
  if (t.validityType === "DATE_RANGE" && t.startDate && t.endDate) {
    const h = (t.endDate.getTime() - t.startDate.getTime()) / 3_600_000;
    if (h > 0 && h <= 4) return { start: berlinHHMM(t.startDate), end: berlinHHMM(t.endDate) };
  }
  return null;
}

/* ------------------------------------------------------------- Auswertung */

const labelOf = (t: PreviewTicket) => t.serviceName ?? t.ticketTypeName ?? "Sonstige";
const personOf = (t: PreviewTicket) => [t.firstName, t.lastName].filter(Boolean).join(" ") || t.name;
const customerOf = (uuid: string | null) => (uuid?.startsWith("anny:") ? uuid.split(":")[1] : null);

function isRental(name: string): boolean {
  return !/flex/i.test(name);
}

export function summarizeBookings(tickets: PreviewTicket[]): DayBookings {
  const bundles = bundleAnnyTickets(
    tickets.map((t) => ({ ...t, startDate: t.startDate ? t.startDate.toISOString() : null, _t: t })),
  ).map((b) => b.primary._t);

  // Je Angebot
  const byService = new Map<string, number>();
  for (const t of bundles) byService.set(labelOf(t), (byService.get(labelOf(t)) ?? 0) + 1);

  // Feste Termine
  const slots = new Map<string, { time: string; end: string | null; label: string; guests: number }>();
  const occupancy = new Map<number, number>(); // Stunde -> Gaeste
  let slottedGuests = 0;
  for (const t of bundles) {
    const w = bookingWindow(t);
    if (!w) continue;
    slottedGuests++;
    const key = `${w.start}|${labelOf(t)}`;
    const e = slots.get(key) ?? { time: w.start, end: w.end, label: labelOf(t), guests: 0 };
    e.guests++;
    slots.set(key, e);
    const s = toMin(w.start);
    let end = w.end ? toMin(w.end) : s + DEFAULT_SLOT_MIN;
    if (end <= s) end = s + DEFAULT_SLOT_MIN;
    for (let h = Math.floor(s / 60); h * 60 < end; h++) occupancy.set(h, (occupancy.get(h) ?? 0) + 1);
  }

  // Stosszeiten: zusammenhaengende Stunden mit mindestens 75 % des Maximums
  const max = Math.max(0, ...occupancy.values());
  const runs: { from: number; to: number; guests: number }[] = [];
  if (max >= 2) {
    const threshold = Math.ceil(max * 0.75);
    for (const h of [...occupancy.keys()].sort((a, b) => a - b)) {
      const n = occupancy.get(h)!;
      if (n < threshold) continue;
      const last = runs[runs.length - 1];
      if (last && last.to === h) {
        last.to = h + 1;
        last.guests = Math.max(last.guests, n);
      } else {
        runs.push({ from: h, to: h + 1, guests: n });
      }
    }
  }
  const peaks = runs
    .sort((a, b) => b.guests - a.guests || a.from - b.from)
    .slice(0, 3)
    .map((r) => ({ from: fromMin(r.from * 60), to: fromMin(r.to * 60), guests: r.guests }));

  // Gruppen: Gaeste eines Auftrags (ohne Auftrags-ID: eines Kunden je Angebot)
  const orders = new Map<string, PreviewTicket[]>();
  for (const t of bundles) {
    const key = t.annyOrderId
      ? `o:${t.annyOrderId}`
      : customerOf(t.uuid)
        ? `c:${customerOf(t.uuid)}|${t.serviceId}`
        : null;
    if (!key) continue;
    const arr = orders.get(key);
    if (arr) arr.push(t);
    else orders.set(key, [t]);
  }
  const groups: DayBookings["groups"] = [];
  for (const members of orders.values()) {
    if (members.length < GROUP_MIN_GUESTS) continue;
    const first = [...members].sort((a, b) => a.id - b.id)[0];
    const labels = [...new Set(members.map(labelOf))];
    const times = [...new Set(members.map((t) => bookingWindow(t)?.start).filter((x): x is string => !!x))].sort();
    groups.push({
      name: first.lastName || personOf(first),
      guests: members.length,
      label: labels.join(", "),
      time: times[0] ?? null,
    });
  }
  groups.sort((a, b) => (a.time ?? "99").localeCompare(b.time ?? "99") || b.guests - a.guests);

  // Verleihmaterial: Add-Ons gehoeren dem Auftrag, also je Auftrag einmal
  const seen = new Set<string>();
  const rentals = new Map<string, number>();
  for (const t of tickets) {
    if (!Array.isArray(t.addOns) || t.addOns.length === 0) continue;
    const key = t.annyOrderId ?? `ticket:${t.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const a of t.addOns as { name?: unknown; quantity?: unknown }[]) {
      if (typeof a?.name !== "string" || !isRental(a.name)) continue;
      const q = typeof a.quantity === "number" && a.quantity > 0 ? a.quantity : 1;
      rentals.set(a.name, (rentals.get(a.name) ?? 0) + q);
    }
  }

  return {
    guests: bundles.length,
    slottedGuests,
    byService: [...byService.entries()]
      .map(([label, guests]) => ({ label, guests }))
      .sort((a, b) => b.guests - a.guests || a.label.localeCompare(b.label, "de")),
    slots: [...slots.values()].sort((a, b) => a.time.localeCompare(b.time) || a.label.localeCompare(b.label, "de")),
    peaks,
    groups,
    rentals: [...rentals.entries()]
      .map(([name, quantity]) => ({ name, quantity }))
      .sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name, "de")),
  };
}
