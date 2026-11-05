/**
 * Tagesvorschau als Telegram-Text (rein, ohne Hub-Konfiguration, testbar).
 *
 * Eingaben: Antwort der Cloud (GET /api/hub/day-preview: Buchungen + Wetter)
 * und der Personal-Stand aus emp-control (staff.ts). Fehlt etwas, steht das
 * kurz im Text, statt dass die ganze Vorschau ausfaellt.
 */
import type { StaffShift } from "./staff-parse.js";

export interface DayPreviewData {
  date: string;
  bookings: {
    guests: number;
    slottedGuests: number;
    byService: { label: string; guests: number }[];
    slots: { time: string; end: string | null; label: string; guests: number }[];
    peaks: { from: string; to: string; guests: number }[];
    groups: { name: string; guests: number; label: string; time: string | null }[];
    rentals: { name: string; quantity: number }[];
  };
  weather: {
    summary: string;
    tempMin: number | null;
    tempMax: number | null;
    precipSumMm: number | null;
    precipProbPct: number | null;
    windMaxKmh: number | null;
    gustMaxKmh: number | null;
    sunrise: string | null;
    sunset: string | null;
    rainWindows: { from: string; to: string; maxProbPct: number | null; mm: number }[];
  } | null;
}

export interface DayPreviewStaff {
  /** false = emp-control nicht eingerichtet, null = unbekannt. */
  configured: boolean | null;
  /** Alter des Stands in Minuten, null = nie abgerufen. */
  dataAgeMin: number | null;
  error: string | null;
  working: { name: string; department: string | null; plannedDepartment: string | null }[];
  shifts: StaffShift[];
}

/** Ab diesen Boeen (km/h) ein Hinweis fuer Lift und Wasser. */
export const GUST_HINT_KMH = 50;
const MAX_SLOT_LINES = 12;

const num = (n: number | null | undefined) => (n == null ? "?" : String(Math.round(n)).replace("-0", "0"));
const dec = (n: number) => String(n).replace(".", ",");
const hour = (hhmm: string) => (hhmm.endsWith(":00") ? String(Number(hhmm.slice(0, 2))) : hhmm);
const hm = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" }) : "?";

function overlaps(a: { from: string; to: string }, b: { from: string; to: string }): boolean {
  return a.from < b.to && b.from < a.to;
}

export function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Europe/Berlin",
  });
}

export function formatWeather(w: DayPreviewData["weather"]): string[] {
  if (!w) return ["Wetter: keine Vorhersage abrufbar."];
  const lines = [
    `Wetter: ${w.summary}, ${num(w.tempMin)} bis ${num(w.tempMax)} °C, Wind bis ${num(w.windMaxKmh)} km/h` +
      (w.gustMaxKmh != null ? ` (Böen ${num(w.gustMaxKmh)})` : ""),
  ];
  if (w.rainWindows.length) {
    lines.push(
      "Regen: " +
        w.rainWindows
          .map((r) => {
            const detail = [r.maxProbPct != null ? `${r.maxProbPct} %` : null, r.mm > 0 ? `${dec(r.mm)} mm` : null].filter(Boolean);
            return `${hour(r.from)}–${hour(r.to)} Uhr${detail.length ? ` (${detail.join(", ")})` : ""}`;
          })
          .join(", "),
    );
  } else if ((w.precipSumMm ?? 0) > 0) {
    lines.push(`Regen: vereinzelt, zusammen ${dec(w.precipSumMm ?? 0)} mm`);
  } else {
    lines.push("Regen: trocken");
  }
  if (w.sunrise && w.sunset) lines.push(`Hell: ${w.sunrise}–${w.sunset}`);
  return lines;
}

export function formatBookings(b: DayPreviewData["bookings"]): string[] {
  if (!b.guests) return ["Buchungen: keine."];
  const lines = [`Buchungen: ${b.guests} ${b.guests === 1 ? "Gast" : "Gäste"}`];
  for (const s of b.byService.slice(0, 8)) lines.push(`• ${s.label}: ${s.guests}`);
  if (b.byService.length > 8) lines.push(`• ${b.byService.length - 8} weitere Angebote`);
  if (b.slots.length) {
    lines.push("Termine:");
    for (const s of b.slots.slice(0, MAX_SLOT_LINES)) lines.push(`• ${s.time}${s.end ? `–${s.end}` : ""} ${s.label}: ${s.guests}`);
    if (b.slots.length > MAX_SLOT_LINES) lines.push(`• und ${b.slots.length - MAX_SLOT_LINES} weitere Termine`);
  }
  if (b.peaks.length) {
    lines.push(
      "Stoßzeit: " + b.peaks.map((p) => `${hour(p.from)}–${hour(p.to)} Uhr (${p.guests} gleichzeitig)`).join(", "),
    );
  }
  if (b.groups.length) {
    lines.push("Gruppen:");
    for (const g of b.groups) lines.push(`• ${g.name}: ${g.guests} Gäste, ${g.label}${g.time ? ` ab ${g.time}` : ""}`);
  }
  if (b.rentals.length) lines.push("Verleih: " + b.rentals.map((r) => `${r.quantity}× ${r.name}`).join(", "));
  return lines;
}

export function formatStaff(s: DayPreviewStaff): string[] {
  if (s.configured === false) return ["Personal: emp-control-Monitor-Link fehlt noch in den Einstellungen."];
  if (s.dataAgeMin == null) return [`Personal: keine Daten aus emp-control${s.error ? ` (${s.error})` : ""}.`];
  const lines: string[] = [];
  const shifts = [...s.shifts].sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""));
  if (!shifts.length && !s.working.length) lines.push("Personal: heute keine Schichten eingeplant.");
  else {
    lines.push("Personal:");
    for (const sh of shifts) {
      const names = sh.pending.length ? `: ${sh.pending.join(", ")}` : "";
      const here = sh.clockedIn ? `, ${sh.clockedIn} schon da` : "";
      lines.push(`• ${sh.department ?? "ohne Bereich"} ${hm(sh.start)}–${sh.end ?? "?"}, ${sh.totalAssigned} eingeplant${here}${names}`);
    }
    if (s.working.length) lines.push(`Eingestempelt: ${s.working.map((w) => w.name).join(", ")}`);
  }
  if (s.dataAgeMin > 15) lines.push(`(Stand vor ${s.dataAgeMin} min${s.error ? `, ${s.error}` : ""})`);
  return lines;
}

/** Hinweise, die sich aus der Kombination ergeben. */
export function previewHints(d: DayPreviewData, staff: DayPreviewStaff | null): string[] {
  const hints: string[] = [];
  const w = d.weather;
  if (w && w.gustMaxKmh != null && w.gustMaxKmh >= GUST_HINT_KMH) {
    hints.push(`Böen bis ${num(w.gustMaxKmh)} km/h: Lift und Wasserbetrieb im Blick behalten.`);
  }
  if (w) {
    const wetPeak = d.bookings.peaks.find((p) => w.rainWindows.some((r) => overlaps(p, r)));
    if (wetPeak) hints.push(`Regen fällt in die Stoßzeit ${hour(wetPeak.from)}–${hour(wetPeak.to)} Uhr.`);
  }
  const bigGroup = d.bookings.groups.find((g) => g.guests >= 10);
  if (bigGroup) hints.push(`Große Gruppe ${bigGroup.name} (${bigGroup.guests}): Material und Einweisung vorbereiten.`);
  if (staff && staff.configured && staff.dataAgeMin != null && d.bookings.guests >= 20 && staff.shifts.length === 0) {
    hints.push(`${d.bookings.guests} Gäste gebucht, aber keine Schicht in emp-control.`);
  }
  return hints;
}

export function formatDayPreview(d: DayPreviewData, staff: DayPreviewStaff | null): string {
  const parts = [`Tagesvorschau ${dayLabel(d.date)}`, formatWeather(d.weather).join("\n"), formatBookings(d.bookings).join("\n")];
  if (staff) parts.push(formatStaff(staff).join("\n"));
  const hints = previewHints(d, staff);
  if (hints.length) parts.push(hints.map((h) => `Hinweis: ${h}`).join("\n"));
  return parts.join("\n\n");
}
