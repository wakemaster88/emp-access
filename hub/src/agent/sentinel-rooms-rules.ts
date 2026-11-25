/**
 * Raumdaten fuer den Waechter: Gilt der Raum einer Kamera gerade als
 * geschlossen (dann wird sie bewacht)? Reine Logik, ohne Netz und ohne Uhr.
 *
 * Die Cloud liefert je Raum, ob er offen ist, und den naechsten Wechsel
 * (nextChangeAt). Der Hub holt das alle 2 Minuten (rooms.ts). Kann er es
 * nicht auffrischen, gilt (effectiveClosed):
 *  - ein Stand juenger als 10 Minuten wie geliefert,
 *  - ein aelterer bis nextChangeAt wie geliefert, danach umgekehrt, soweit
 *    das die Bewachung einschaltet: Aus „offen“ wird „geschlossen“. Aus
 *    „geschlossen“ wird nicht „offen“, die Kamera faellt dann auf das
 *    Nachtfenster zurueck (null). Ein alter Stand schaltet die Bewachung so
 *    nie ab.
 *  - ein aelterer ohne nextChangeAt (aeltere Cloud, kein Wechsel in Sicht)
 *    ergibt null: Dann entscheidet das Nachtfenster.
 * Ab 30 Minuten ist ein alter Stand ein Befund des Zustands-Waechters
 * (roomsFinding).
 */
import type { Finding } from "./findings.js";

/** So lange gilt ein Stand wie geliefert. */
export const ROOMS_MAX_AGE_MS = 10 * 60_000;

/** Zeitpunkt aus einer ISO-Angabe oder Millisekunden; null, wenn unlesbar. */
function toMs(v: string | number | null | undefined): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Raum geschlossen? true = geschlossen (bewacht), false = offen, null = nicht
 * sicher bekannt, das Nachtfenster entscheidet. `syncedAt` ist der Zeitpunkt
 * des Stands, auch wenn er von der Platte kommt.
 */
export function effectiveClosed(i: {
  open: boolean;
  nextChangeAt: string | number | null | undefined;
  syncedAt: string | number | null | undefined;
  now: number;
  maxAgeMs: number;
}): boolean | null {
  const synced = toMs(i.syncedAt);
  if (synced !== null && Math.abs(i.now - synced) < i.maxAgeMs) return !i.open;
  const change = toMs(i.nextChangeAt);
  if (change === null) return null;
  if (i.now < change) return !i.open;
  // Nach dem Wechsel: offen wird geschlossen (bewacht); geschlossen faellt aufs Nachtfenster.
  return i.open ? true : null;
}

/** Ein Raum mit Betriebszeit, wie er mit den Raumdaten kommt. */
export interface RoomState {
  name: string;
  open: boolean;
  nextChangeAt?: string | null;
}

export interface RoomsClosed {
  /** true = alle Raeume geschlossen, false = einer offen, null = Nachtfenster entscheidet. */
  closed: boolean | null;
  /** Namen der Raeume der Kamera mit Betriebszeit. */
  rooms: string[];
  /** Der Stand ist aelter als `maxAgeMs`: `closed` ist aus nextChangeAt gerechnet. */
  stale: boolean;
}

/**
 * Raeume einer Kamera zusammen: Ist einer offen, ist die Kamera nicht
 * bewacht (false); sind alle geschlossen, ist sie bewacht (true); sonst
 * entscheidet das Nachtfenster (null). Ohne Raum mit Betriebszeit null.
 */
export function roomsClosed(
  rooms: readonly RoomState[],
  syncedAt: string | number | null | undefined,
  now: number,
  maxAgeMs = ROOMS_MAX_AGE_MS
): RoomsClosed {
  if (!rooms.length) return { closed: null, rooms: [], stale: false };
  const synced = toMs(syncedAt);
  const stale = synced === null || Math.abs(now - synced) >= maxAgeMs;
  const values = rooms.map((r) => effectiveClosed({ open: r.open, nextChangeAt: r.nextChangeAt, syncedAt, now, maxAgeMs }));
  const closed = values.some((v) => v === false) ? false : values.every((v) => v === true) ? true : null;
  return { closed, rooms: rooms.map((r) => r.name), stale };
}

/** Ab so alten Raumdaten meldet der Zustands-Waechter einen Befund. */
export const ROOMS_STALE_FINDING_MS = 30 * 60_000;

/**
 * Befund „Raumdaten seit N min alt“, wenn der Stand mindestens 30 Minuten alt
 * ist; ohne Stand zaehlt die Zeit seit dem Start des Hubs. null = kein Befund.
 */
export function roomsFinding(i: { syncedAt: number | null; startedAt: number; now: number; error: string | null }): Finding | null {
  const since = i.syncedAt ?? i.startedAt;
  const ageMs = i.now - since;
  if (!(ageMs >= ROOMS_STALE_FINDING_MS)) return null;
  const minutes = Math.floor(ageMs / 60_000);
  return {
    key: "rooms",
    severity: "warn",
    title: i.syncedAt === null ? `Raumdaten fehlen seit ${minutes} min` : `Raumdaten seit ${minutes} min alt`,
    detail:
      (i.error ? `Abruf: ${i.error}. ` : "") +
      "Der Wächter hält den letzten Stand bis zum nächsten Wechsel für gültig, danach bewacht er die Kamera oder richtet sich nach dem Nachtfenster.",
  };
}
