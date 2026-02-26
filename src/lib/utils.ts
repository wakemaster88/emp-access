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
