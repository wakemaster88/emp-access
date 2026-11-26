/**
 * Testfaelle zu Bewegungs-Regeln, die der Hub direkt ausfuehrt: Abklingzeit
 * und erlaubte Zeitraeume. Dieselben Faelle pruefen den Hub
 * (motion-rules.test.ts) und die Cloud (src/lib/rule-executor.test.ts),
 * damit beide gleich entscheiden, ob eine Regel zu einem Ereignis laeuft.
 * Nur Testdaten.
 */

export interface CooldownCase {
  name: string;
  /** Letzter Lauf (ms); null = noch nie. */
  lastRunAt: number | null;
  cooldownSeconds: number;
  /** Zeit des Ereignisses (ms). */
  at: number;
  free: boolean;
}

const T = Date.parse("2026-11-28T18:00:00.000Z");

export const COOLDOWN_CASES: readonly CooldownCase[] = [
  { name: "noch nie gelaufen", lastRunAt: null, cooldownSeconds: 60, at: T, free: true },
  { name: "Abklingzeit vorbei", lastRunAt: T - 61_000, cooldownSeconds: 60, at: T, free: true },
  { name: "genau auf der Grenze: noch gesperrt", lastRunAt: T - 60_000, cooldownSeconds: 60, at: T, free: false },
  { name: "1 ms vor der Grenze", lastRunAt: T - 59_999, cooldownSeconds: 60, at: T, free: false },
  { name: "1 ms nach der Grenze", lastRunAt: T - 60_001, cooldownSeconds: 60, at: T, free: true },
  { name: "ohne Abklingzeit, Lauf vorher", lastRunAt: T - 1, cooldownSeconds: 0, at: T, free: true },
  { name: "ohne Abklingzeit, Lauf zur selben Zeit", lastRunAt: T, cooldownSeconds: 0, at: T, free: false },
  { name: "Lauf nach dem Ereignis (Uhr)", lastRunAt: T + 5_000, cooldownSeconds: 60, at: T, free: false },
  { name: "negative Abklingzeit wie 0", lastRunAt: T - 1, cooldownSeconds: -5, at: T, free: true },
];

export interface AllowedCase {
  name: string;
  intervals: Array<{ from: string; to: string }>;
  at: number;
  allowed: boolean;
}

const window = [{ from: "2026-11-28T17:00:00.000Z", to: "2026-11-28T21:00:00.000Z" }];

export const ALLOWED_CASES: readonly AllowedCase[] = [
  { name: "im Zeitraum", intervals: window, at: T, allowed: true },
  { name: "Beginn gehoert dazu", intervals: window, at: Date.parse(window[0].from), allowed: true },
  { name: "Ende gehoert nicht dazu", intervals: window, at: Date.parse(window[0].to), allowed: false },
  { name: "1 ms vor dem Ende", intervals: window, at: Date.parse(window[0].to) - 1, allowed: true },
  { name: "1 ms vor dem Beginn", intervals: window, at: Date.parse(window[0].from) - 1, allowed: false },
  { name: "ohne Zeitraeume nie", intervals: [], at: T, allowed: false },
  {
    name: "zweiter Zeitraum",
    intervals: [window[0], { from: "2026-11-29T06:00:00.000Z", to: "2026-11-29T07:00:00.000Z" }],
    at: Date.parse("2026-11-29T06:30:00.000Z"),
    allowed: true,
  },
  { name: "unlesbarer Zeitraum zaehlt nicht", intervals: [{ from: "x", to: "y" }], at: T, allowed: false },
];
