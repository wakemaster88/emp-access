/**
 * Lieferdienst am Kennzeichen wiedererkennen: Kennzeichen, an denen schon
 * einmal eine Marke gelesen wurde, mit der Marke merken. Reine Logik, Datei
 * und Ablauf in delivery.ts. Ein gemerktes Kennzeichen loest nur Meldungen
 * aus, nie das Tor (dafuer das Kennzeichen als freigegebenes Fahrzeug eintragen).
 */
import { normalizePlate } from "./agent/repeat-vehicles.js";

/** Nur sicher gelesene Kennzeichen merken und wiedererkennen. */
export const PLATE_MIN_CONF = 0.9;
export const PLATE_TTL_MS = 90 * 24 * 60 * 60_000;
export const PLATE_MAX = 200;

export interface PlateEntry {
  brand: string;
  firstAt: number;
  lastAt: number;
  seen: number;
}

export type PlateMemory = Record<string, PlateEntry>;

function plateKey(plate: string): string | null {
  const k = normalizePlate(plate);
  return k.length >= 4 ? k : null;
}

export function brandForPlate(mem: PlateMemory, plate: string, now: number): string | null {
  const k = plateKey(plate);
  const e = k ? mem[k] : undefined;
  return e && now - e.lastAt < PLATE_TTL_MS ? e.brand : null;
}

/** Sichtung mit Marke verbuchen. true = neu gelernt. */
export function rememberPlate(mem: PlateMemory, plate: string, brand: string, now: number): boolean {
  const k = plateKey(plate);
  if (!k) return false;
  const e = mem[k];
  const fresh = !e || now - e.lastAt >= PLATE_TTL_MS;
  mem[k] = fresh ? { brand, firstAt: now, lastAt: now, seen: 1 } : { ...e, brand, lastAt: now, seen: e.seen + 1 };
  prunePlates(mem, now);
  return fresh;
}

/** Abgelaufene entfernen, dann die am laengsten nicht gesehenen bis PLATE_MAX. */
export function prunePlates(mem: PlateMemory, now: number): void {
  for (const [k, e] of Object.entries(mem)) if (now - e.lastAt >= PLATE_TTL_MS) delete mem[k];
  const keys = Object.keys(mem);
  if (keys.length <= PLATE_MAX) return;
  keys.sort((a, b) => mem[a].lastAt - mem[b].lastAt);
  for (const k of keys.slice(0, keys.length - PLATE_MAX)) delete mem[k];
}
