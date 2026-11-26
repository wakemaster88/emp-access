/**
 * Sperre nach abgelehnten Zugangsdaten: Regeln ohne Datei und ohne Uhr. Den
 * Zustand haelt auth-latch-store.ts (hub/.cache/auth-latch.json); DoorBird
 * (doorbird.ts), Shelly (shelly.ts) und die Kamerasuche (cameras.ts) fragen
 * vor jeder Anfrage mit Zugangsdaten hier nach.
 *
 * Nach zwei Ablehnungen in Folge (HTTP 401 oder 403) fuer dasselbe Geraet mit
 * denselben Zugangsdaten gibt es keine weiteren Versuche. Die Sperre loest
 * sich,
 * - wenn sich die Zugangsdaten aendern (Fingerabdruck, ein Hash, nie die
 *   Daten selbst),
 * - wenn der Eintrag des Geraets in der Cloud neu gespeichert wurde
 *   (`rev`, ein Aenderungszeitpunkt, sofern die Liste einen liefert),
 * - wenn ein Versuch gelingt.
 * Damit sie sich auch von selbst loest (Zugangsdaten am Geraet
 * zurueckgestellt), darf je Geraet ein einzelner Versuch in 24 Stunden
 * stattfinden.
 *
 * Die Kamerasuche fragt fremde Adressen: je Adresse hoechstens ein Versuch in
 * 24 Stunden, nach einer Ablehnung dort nie wieder mit denselben Daten.
 */
import { createHash } from "node:crypto";

/** Ablehnungen in Folge bis zur Sperre. */
export const AUTH_REJECTIONS_TO_LOCK = 2;
/** Abstand der einzelnen Versuche waehrend einer Sperre und je fremder Adresse der Kamerasuche. */
export const AUTH_SINGLE_TRY_MS = 24 * 60 * 60_000;
/** Nicht gesperrte Eintraege (eine einzelne Ablehnung) verfallen nach so langer Ruhe. */
export const AUTH_IDLE_DROP_MS = 7 * 24 * 60 * 60_000;
/** Hoechstens so viele Adressen der Kamerasuche im Merker. */
export const PROBE_MARKS_MAX = 500;
/** Hoechstens so viele abgelehnte Fingerabdruecke je Adresse. */
const PROBE_REJECTED_MAX = 8;

/**
 * Ausgang eines Versuchs: angenommen (2xx), abgelehnt (401/403), eine andere
 * Antwort des Geraets, oder keine Antwort (Netz, Zeitlimit).
 */
export type AuthOutcome = "ok" | "abgelehnt" | "anders" | "keine";

export function authOutcome(status: number | null): AuthOutcome {
  if (status === null) return "keine";
  if (status === 401 || status === 403) return "abgelehnt";
  if (status >= 200 && status < 300) return "ok";
  return "anders";
}

/**
 * Fingerabdruck der Zugangsdaten (und was sonst zum Ziel gehoert, etwa
 * Adresse und Port): 16 Hex-Zeichen eines SHA-256. Daraus laesst sich das
 * Passwort nicht ablesen; gespeichert und verglichen wird nur er.
 */
export function credentialFingerprint(...parts: Array<string | number | boolean | null | undefined>): string {
  return createHash("sha256")
    .update(`emp-hub-zugang\u0000${JSON.stringify(parts.map((p) => p ?? null))}`)
    .digest("hex")
    .slice(0, 16);
}

export interface LatchEntry {
  /** Fingerabdruck der Zugangsdaten, mit denen abgelehnt wurde. */
  fp: string;
  /** Ablehnungen in Folge mit diesem Fingerabdruck. */
  rejections: number;
  /** Gesperrt seit (ms), 0 = nicht gesperrt. */
  lockedAt: number;
  /** Letzter Versuch (ms); waehrend der Sperre der letzte einzelne Versuch. */
  lastTryAt: number;
  /** Aenderungszeitpunkt des Eintrags in der Cloud, null = unbekannt. */
  rev: string | null;
}

export interface LatchGate {
  /** Darf jetzt ein Versuch hinaus? */
  allow: boolean;
  /** Stand nach dieser Pruefung (null = kein Eintrag mehr). */
  entry: LatchEntry | null;
  /** Eine Sperre hat sich geloest: Zugangsdaten geaendert oder Eintrag neu gespeichert. */
  released: "zugangsdaten" | "eintrag" | null;
  /** Der Versuch ist der einzelne waehrend einer Sperre. */
  single: boolean;
  /** Gesperrt: naechster einzelner Versuch (ms). */
  nextTryAt: number | null;
}

/** Vor einem Versuch: erlaubt, gesperrt, oder der einzelne Versuch in 24 Stunden. */
export function latchGate(entry: LatchEntry | null, fp: string, now: number, rev: string | null = null): LatchGate {
  const free = (next: LatchEntry | null, released: LatchGate["released"] = null): LatchGate => ({
    allow: true,
    entry: next,
    released,
    single: false,
    nextTryAt: null,
  });
  if (!entry) return free(null);
  const locked = entry.lockedAt > 0;
  // Andere Zugangsdaten oder neu gespeicherter Eintrag: Was vorher abgelehnt
  // wurde, zaehlt nicht mehr.
  if (entry.fp !== fp) return free(null, locked ? "zugangsdaten" : null);
  if (rev !== null && entry.rev !== null && rev !== entry.rev) return free(null, locked ? "eintrag" : null);
  if (!locked) return free(entry);
  const nextTryAt = entry.lastTryAt + AUTH_SINGLE_TRY_MS;
  // Uhr zurueckgestellt: lieber einmal versuchen als bis weit in die Zukunft sperren.
  if (now >= nextTryAt || now < entry.lastTryAt) {
    return { allow: true, entry: { ...entry, lastTryAt: now }, released: null, single: true, nextTryAt: null };
  }
  return { allow: false, entry, released: null, single: false, nextTryAt };
}

export interface LatchNote {
  entry: LatchEntry | null;
  /** Mit diesem Versuch gesperrt. */
  locked: boolean;
  /** Mit diesem Versuch geloest (er gelang). */
  released: boolean;
}

/**
 * Nach einem Versuch (`entry` ist der Stand aus latchGate). Angenommen: kein
 * Eintrag mehr. Abgelehnt: eine Ablehnung mehr, ab der zweiten in Folge
 * gesperrt. Eine andere Antwort beendet die Folge, solange nicht gesperrt;
 * keine Antwort aendert nichts.
 */
export function latchNote(
  entry: LatchEntry | null,
  fp: string,
  outcome: AuthOutcome,
  now: number,
  rev: string | null = null
): LatchNote {
  const same =
    entry && entry.fp === fp && (rev === null || entry.rev === null || entry.rev === rev) ? entry : null;
  if (outcome === "ok") return { entry: null, locked: false, released: !!same && same.lockedAt > 0 };
  if (outcome === "keine") return { entry: same, locked: false, released: false };
  if (outcome === "anders") {
    return { entry: same && same.lockedAt > 0 ? same : null, locked: false, released: false };
  }
  const base: LatchEntry = same ?? { fp, rejections: 0, lockedAt: 0, lastTryAt: 0, rev };
  const rejections = base.rejections + 1;
  const lock = base.lockedAt === 0 && rejections >= AUTH_REJECTIONS_TO_LOCK;
  return {
    entry: { ...base, rev: rev ?? base.rev, rejections, lastTryAt: now, lockedAt: lock ? now : base.lockedAt },
    locked: lock,
    released: false,
  };
}

/** Gilt fuer diese Zugangsdaten gerade eine Sperre? */
export function latchLocked(entry: LatchEntry | null, fp: string, rev: string | null = null): boolean {
  if (!entry || entry.lockedAt === 0 || entry.fp !== fp) return false;
  return rev === null || entry.rev === null || entry.rev === rev;
}

/* --------------------------------------------------- fremde Adressen */

export interface ProbeMark {
  /** Letzter Versuch an dieser Adresse (ms), gleich mit welchen Zugangsdaten. */
  lastTryAt: number;
  /** Fingerabdruecke, die diese Adresse abgelehnt hat. */
  rejected: string[];
}

/** Darf die Kamerasuche diese fremde Adresse jetzt mit diesen Zugangsdaten fragen? */
export function probeAllowed(mark: ProbeMark | null, fp: string, now: number): boolean {
  if (!mark) return true;
  if (mark.rejected.includes(fp)) return false;
  return now - mark.lastTryAt >= AUTH_SINGLE_TRY_MS || now < mark.lastTryAt;
}

/** Merker nach einem Versuch an einer fremden Adresse. */
export function probeMarkAfter(mark: ProbeMark | null, fp: string, outcome: AuthOutcome, now: number): ProbeMark {
  const rejected = mark?.rejected ?? [];
  return {
    lastTryAt: now,
    rejected:
      outcome === "abgelehnt" && !rejected.includes(fp) ? [...rejected, fp].slice(-PROBE_REJECTED_MAX) : rejected,
  };
}

/* ------------------------------------------------------------ Datei */

export interface LatchFile {
  devices: Map<string, LatchEntry>;
  probes: Map<string, ProbeMark>;
}

const FP_RE = /^[0-9a-f]{16}$/;
const isTime = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

function parseEntry(v: unknown): LatchEntry | null {
  if (typeof v !== "object" || v === null) return null;
  const e = v as Record<string, unknown>;
  if (typeof e.fp !== "string" || !FP_RE.test(e.fp)) return null;
  if (!Number.isInteger(e.rejections) || (e.rejections as number) < 0) return null;
  if (!isTime(e.lockedAt) || !isTime(e.lastTryAt)) return null;
  if (e.rev !== null && e.rev !== undefined && typeof e.rev !== "string") return null;
  return { fp: e.fp, rejections: e.rejections as number, lockedAt: e.lockedAt, lastTryAt: e.lastTryAt, rev: (e.rev as string | null | undefined) ?? null };
}

function parseMark(v: unknown): ProbeMark | null {
  if (typeof v !== "object" || v === null) return null;
  const m = v as Record<string, unknown>;
  if (!isTime(m.lastTryAt) || !Array.isArray(m.rejected)) return null;
  const rejected = m.rejected.filter((f): f is string => typeof f === "string" && FP_RE.test(f));
  return { lastTryAt: m.lastTryAt, rejected: rejected.slice(-PROBE_REJECTED_MAX) };
}

/** Was nicht mehr zaehlt, faellt weg: alte einzelne Ablehnungen, Adressen ohne Ablehnung nach 24 h. */
function tidy(file: LatchFile, now: number): LatchFile {
  const devices = new Map(
    [...file.devices].filter(([, e]) => e.lockedAt > 0 || !(now - e.lastTryAt > AUTH_IDLE_DROP_MS))
  );
  const probes = new Map(
    [...file.probes]
      .filter(([, m]) => m.rejected.length > 0 || !(now - m.lastTryAt >= AUTH_SINGLE_TRY_MS))
      .sort((a, b) => b[1].lastTryAt - a[1].lastTryAt)
      .slice(0, PROBE_MARKS_MAX)
  );
  return { devices, probes };
}

/** Inhalt der Datei lesen; Unlesbares faellt weg, der Rest gilt. */
export function parseLatchFile(raw: unknown, now: number): LatchFile {
  const out: LatchFile = { devices: new Map(), probes: new Map() };
  if (typeof raw !== "object" || raw === null || (raw as Record<string, unknown>).version !== 1) return out;
  const r = raw as Record<string, unknown>;
  for (const [key, v] of Object.entries(typeof r.devices === "object" && r.devices ? r.devices : {})) {
    const e = parseEntry(v);
    if (e) out.devices.set(key, e);
  }
  for (const [ip, v] of Object.entries(typeof r.probes === "object" && r.probes ? r.probes : {})) {
    const m = parseMark(v);
    if (m) out.probes.set(ip, m);
  }
  return tidy(out, now);
}

/** Text der Datei: nur Schluessel, Fingerabdruecke und Zeitpunkte. */
export function serializeLatchFile(file: LatchFile, now: number): string {
  const t = tidy(file, now);
  return JSON.stringify(
    { version: 1, devices: Object.fromEntries(t.devices), probes: Object.fromEntries(t.probes) },
    null,
    2
  );
}

/* --------------------------------------------------- Meldung an die Cloud */

/**
 * Quelle der Meldung „Zugangsdaten abgelehnt“ (POST /api/hub/alerts), je Hub
 * wie staleAlertSource in whitelist-rules.ts: Die Cloud schliesst, was eine
 * Quelle nicht mehr meldet; ein zweiter Hub am selben Konto schliesst so nicht
 * den Befund eines anderen.
 */
export function authAlertSource(hubName: string): string {
  const slug = hubName
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 18)
    .replace(/-+$/, "");
  return slug ? `zugang-${slug}` : "zugang";
}
