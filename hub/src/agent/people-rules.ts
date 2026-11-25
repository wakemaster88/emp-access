/**
 * Merkliste der Personen fuer die Wiedererkennung ueber Kameras: welche Art
 * ein Eintrag hat, wie lange er gilt und was eine Entscheidung des Waechters
 * an der Liste aendert. Reine Logik, ohne Datei und ohne Uhr.
 */
import { inQuietHours } from "./quiet.js";
import type { ClearBasis } from "./sentinel-rules.js";

/**
 * Art eines Eintrags:
 *  - gemeldet: Fuer diese Person ging ein Alarm hinaus. Der Eintrag verhindert
 *    nur, dass dieselbe Person an der naechsten Kamera sofort wieder Alarm
 *    ausloest, und endet REPORTED_MS nach dem Alarm.
 *  - freigegeben: per Knopf „Ist in Ordnung“ oder durch einen Gesichts-
 *    Treffer auf der Whitelist.
 *  - mitarbeiter: vermutlich Mitarbeiter (eingestempeltes Personal, Arbeit am
 *    Tag). Zaehlt im Nachtfenster nicht als bekannt.
 */
export type PersonKind = "gemeldet" | "freigegeben" | "mitarbeiter";

/**
 * Eine gemerkte Person. Gespeichert wird nur eine kurze Kleidungsbeschreibung
 * des Bildmodells, kein Bild und kein Gesichtsmerkmal.
 */
export interface ClearedPerson {
  id: string;
  kind: PersonKind;
  /** Name des Gesichts-Treffers, „Mitarbeiter“, „bereits gemeldet“ oder der Text der Freigabe. */
  label: string;
  kleidung: string;
  /** Kamera der letzten Sichtung; bei gemeldeten Eintraegen die Kamera des Alarms. */
  camera: string;
  /** Zeitpunkt der letzten Sichtung; bei gemeldeten Eintraegen der Zeitpunkt des Alarms. */
  at: number;
  until: number;
}

/** Knopf „Ist in Ordnung“ an einem Alarm: Kleidung der gemeldeten Personen. */
export interface PendingOk {
  camera: string;
  kleidung: string[];
  at: number;
}

/** Inhalt der Datei .cache/agent-people.json. */
export interface PeopleStore {
  cleared: ClearedPerson[];
  pending: Array<[string, PendingOk]>;
}

/** So lange gelten freigegebene Eintraege und Mitarbeiter-Eintraege ab der letzten Sichtung. */
export const CLEAR_MS = 8 * 60 * 60_000;
/** So lange gilt eine gemeldete Person als „schon gemeldet“ (keine Wiederholung). */
export const REPORTED_MS = 20 * 60_000;
export const MAX_CLEARED = 30;
export const REPORTED_LABEL = "bereits gemeldet";
export const STAFF_LABEL = "Mitarbeiter";

const KINDS: readonly PersonKind[] = ["gemeldet", "freigegeben", "mitarbeiter"];
const isKind = (v: unknown): v is PersonKind => typeof v === "string" && (KINDS as readonly string[]).includes(v);
const isText = (v: unknown): v is string => typeof v === "string";
const isTime = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Gueltigkeit ab der letzten Sichtung bzw. ab dem Alarm. */
export function lifetimeMs(kind: PersonKind): number {
  return kind === "gemeldet" ? REPORTED_MS : CLEAR_MS;
}

/** Art eines Eintrags, der noch ohne das Feld `kind` gespeichert wurde. */
export function kindFromLabel(label: string): PersonKind {
  const l = label.trim();
  if (l === REPORTED_LABEL) return "gemeldet";
  if (l === STAFF_LABEL) return "mitarbeiter";
  return "freigegeben";
}

/**
 * Einen Eintrag aus der Datei uebernehmen; null, wenn ein Feld fehlt oder
 * nicht passt. Kein Eintrag gilt laenger, als seine Art ab seinem Zeitpunkt
 * erlaubt: Eine laengere Frist aus der Datei wird gekuerzt.
 */
export function reviveEntry(raw: unknown, now: number): ClearedPerson | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!isText(o.id) || !o.id || !isText(o.label) || !isText(o.kleidung) || !isText(o.camera) || !isTime(o.at) || !isTime(o.until)) return null;
  const kind = isKind(o.kind) ? o.kind : kindFromLabel(o.label);
  const at = Math.min(o.at, now);
  return { id: o.id, kind, label: o.label, kleidung: o.kleidung, camera: o.camera, at, until: Math.min(o.until, at + lifetimeMs(kind)) };
}

function revivePending(raw: unknown): [string, PendingOk] | null {
  if (!Array.isArray(raw) || raw.length !== 2 || !isText(raw[0]) || !raw[0]) return null;
  const o = raw[1] as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || !isText(o.camera) || !isTime(o.at) || !Array.isArray(o.kleidung) || !o.kleidung.every(isText)) return null;
  return [raw[0], { camera: o.camera, kleidung: o.kleidung, at: o.at }];
}

/**
 * Dateiinhalt lesen. null = kein Objekt, also nicht verwertbar. `dropped`
 * zaehlt die Eintraege, die nicht uebernommen wurden.
 */
export function reviveStore(raw: unknown, now: number): { store: PeopleStore; dropped: number } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const store: PeopleStore = { cleared: [], pending: [] };
  let dropped = 0;
  for (const item of Array.isArray(o.cleared) ? o.cleared : []) {
    const entry = reviveEntry(item, now);
    if (entry) store.cleared.push(entry);
    else dropped++;
  }
  for (const item of Array.isArray(o.pending) ? o.pending : []) {
    const pending = revivePending(item);
    if (pending) store.pending.push(pending);
    else dropped++;
  }
  return { store, dropped };
}

/** Abgelaufene Eintraege entfernen, hoechstens MAX_CLEARED behalten (die juengsten). */
export function pruneCleared(entries: ClearedPerson[], now: number): ClearedPerson[] {
  return entries.filter((c) => c.until > now).slice(-MAX_CLEARED);
}

/**
 * Zaehlt der Eintrag jetzt als bekannte Person? Mitarbeiter-Eintraege nicht im
 * Nachtfenster des Waechters: Nachts entscheidet jede Sichtung neu (Stempeluhr
 * und Arbeitskleidung). Ohne lesbare Stunde zaehlen sie ebenfalls nicht.
 */
export function knownUsable(entry: Pick<ClearedPerson, "kind">, hour: number, nightWindow: string): boolean {
  if (entry.kind !== "mitarbeiter") return true;
  return Number.isFinite(hour) && !inQuietHours(nightWindow, hour);
}

/**
 * Genau eine Person im Bild? Nur dann gehoert ein Gesichts-Treffer oder die
 * Stempeluhr sicher zu der einen Kleidungsbeschreibung. `tracked` ist die
 * Zahl der Personen, die der Tracker auf dem Uebersichtsbild gefunden hat
 * (null = unbekannt); die Nahaufnahme kann weniger zeigen.
 */
export function singlePerson(s: { persons: number | null; tracked?: number | null; kleidung: string[] }): boolean {
  return s.persons === 1 && s.kleidung.length <= 1 && (s.tracked == null || s.tracked <= 1);
}

/**
 * Als was merkt sich die Liste eine Person nach einer Entscheidung „kein Alarm“?
 *  - Starker Gesichts-Treffer auf der Whitelist: freigegeben, unter dem Namen
 *    des Treffers.
 *  - Eingestempeltes Personal oder Arbeit am Tag: Mitarbeiter-Eintrag.
 *  - Schwacher Gesichts-Treffer mit zweitem Signal („hinweis“), alle schon
 *    bekannt oder niemand im Bild: nichts Neues. Aus einem unsicheren Treffer
 *    wird keine Freigabe.
 */
export function grantFor(basis: ClearBasis, faceName?: string | null): { kind: "freigegeben" | "mitarbeiter"; label: string } | null {
  if (basis === "gesicht") return { kind: "freigegeben", label: faceName?.trim() || "Gesicht erkannt" };
  if (basis === "eingestempelt" || basis === "arbeit") return { kind: "mitarbeiter", label: STAFF_LABEL };
  return null;
}

/** Eine Entscheidung „kein Alarm“ des Waechters, soweit die Merkliste sie braucht. */
export interface Sighting {
  now: number;
  camera: string;
  basis: ClearBasis;
  /** Name des Gesichts-Treffers bei basis "gesicht". */
  faceName?: string | null;
  /** Personen im Bild laut Nahaufnahme; null = keine Bewertung. */
  persons: number | null;
  /** Personen laut Tracker auf dem Uebersichtsbild; null = unbekannt. */
  tracked?: number | null;
  /** Personen im Bild ohne passenden Eintrag. */
  unknown: number;
  /** Kleidungsbeschreibungen des Bildes. */
  kleidung: string[];
  /** IDs der wiedererkannten Eintraege. */
  matchedIds: string[];
}

export interface SightingResult {
  entries: ClearedPerson[];
  /** Freigegebene und Mitarbeiter-Eintraege, deren Frist neu beginnt. */
  extended: number;
  /** Gemeldete Eintraege, die jetzt freigegeben bzw. Mitarbeiter sind. */
  promoted: number;
  /** Neu gemerkte Kleidungsbeschreibungen. */
  added: number;
  /** Beschreibungen, die nicht gemerkt wurden, weil mehrere Personen im Bild sind. */
  withheld: number;
}

/**
 * Merkliste nach einer Entscheidung „kein Alarm“:
 *  - Wiedererkannte freigegebene Eintraege und Mitarbeiter-Eintraege gelten
 *    ab jetzt wieder CLEAR_MS.
 *  - Ein gemeldeter Eintrag bleibt, wie er ist: Er endet REPORTED_MS nach dem
 *    Alarm, danach gibt es fuer die Person wieder einen Alarm. Nur wenn genau
 *    eine Person im Bild ist und die Entscheidung auf einem Gesichts-Treffer
 *    (dann freigegeben) oder auf eingestempeltem Personal (dann Mitarbeiter-
 *    Eintrag) beruht, wird er umgestellt.
 *  - Neue Beschreibungen kommen nur dazu, wenn genau eine Person im Bild ist:
 *    Bei mehreren ist offen, zu wem das Gesicht oder die Stempeluhr gehoert.
 *  - Niemand im Bild: Die Liste bleibt unveraendert.
 */
export function afterNoAlarm(entries: ClearedPerson[], s: Sighting, newId: () => string): SightingResult {
  const out = entries.map((e) => ({ ...e }));
  const res: SightingResult = { entries: out, extended: 0, promoted: 0, added: 0, withheld: 0 };
  if (s.basis === "leer") return res;
  const single = singlePerson(s);
  const grant = grantFor(s.basis, s.faceName);
  const promote = single && (s.basis === "gesicht" || s.basis === "eingestempelt") ? grant : null;
  const matched = new Set(s.matchedIds);
  for (const e of out) {
    if (!matched.has(e.id)) continue;
    if (e.kind === "gemeldet") {
      if (!promote) continue;
      e.kind = promote.kind;
      e.label = promote.label;
      res.promoted++;
    } else {
      res.extended++;
    }
    e.until = Math.max(e.until, s.now + CLEAR_MS);
    e.at = s.now;
    e.camera = s.camera;
  }
  if (s.unknown > 0 && s.kleidung.length && grant) {
    if (single) {
      for (const k of s.kleidung) out.push(newEntry(grant.kind, grant.label, k, s.camera, s.now, newId));
      res.added = s.kleidung.length;
    } else {
      res.withheld = s.kleidung.length;
    }
  }
  return res;
}

function newEntry(kind: PersonKind, label: string, kleidung: string, camera: string, now: number, newId: () => string): ClearedPerson {
  return { id: newId(), kind, label, kleidung, camera, at: now, until: now + lifetimeMs(kind) };
}

/** Nach einem Alarm: jede beschriebene Person REPORTED_MS als gemeldet merken. */
export function afterAlarm(
  entries: ClearedPerson[],
  s: { now: number; camera: string; kleidung: string[] },
  newId: () => string,
): ClearedPerson[] {
  return [...entries, ...s.kleidung.map((k) => newEntry("gemeldet", REPORTED_LABEL, k, s.camera, s.now, newId))];
}

/** Knopf „Ist in Ordnung“: die Personen des Alarms CLEAR_MS als freigegeben merken. */
export function afterOk(
  entries: ClearedPerson[],
  s: { now: number; camera: string; kleidung: string[]; label: string },
  newId: () => string,
): ClearedPerson[] {
  return [...entries, ...s.kleidung.map((k) => newEntry("freigegeben", s.label, k, s.camera, s.now, newId))];
}
