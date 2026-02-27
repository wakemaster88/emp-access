import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const TZ = "Europe/Berlin";

export function fmtDate(d: Date | string, opts?: Intl.DateTimeFormatOptions) {
  return new Date(d).toLocaleDateString("de-DE", { timeZone: TZ, ...opts });
}

export function fmtTime(d: Date | string, opts?: Intl.DateTimeFormatOptions) {
  return new Date(d).toLocaleTimeString("de-DE", { timeZone: TZ, ...opts });
}

export function fmtDateTime(d: Date | string, opts?: Intl.DateTimeFormatOptions) {
  return new Date(d).toLocaleString("de-DE", { timeZone: TZ, ...opts });
}

/** Kurz für Tabellen: dd.MM.yy */
export function fmtDateShort(d: Date | string) {
  return new Date(d).toLocaleDateString("de-DE", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "2-digit" });
}

/** Kurz für Tabellen: dd.MM.yy, HH:mm (ohne Sekunden) */
export function fmtDateTimeShort(d: Date | string) {
  const dt = new Date(d);
  const date = dt.toLocaleDateString("de-DE", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "2-digit" });
  const time = dt.toLocaleTimeString("de-DE", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
  return `${date}, ${time}`;
}

/** Nur Datum relevant (Mitternacht in Zeitzone)? Dann Zeit weglassen für kompakte Anzeige. */
export function isDateOnly(d: Date | string): boolean {
  const dt = new Date(d);
  const h = dt.toLocaleString("de-DE", { timeZone: TZ, hour: "2-digit", hour12: false });
  const m = dt.toLocaleString("de-DE", { timeZone: TZ, minute: "2-digit" });
  return h === "00" && m === "00";
}
