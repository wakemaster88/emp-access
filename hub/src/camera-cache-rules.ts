/**
 * Lokale Kopie der Kamera-Liste (hub/.cache/cameras.json): Regeln ohne Datei
 * und ohne Uhr. Die Datei schreibt und liest cameras.ts.
 *
 * Die Kopie ist die letzte gelungene Antwort von GET /api/hub/cameras. Sie
 * enthaelt wie die Einstellungsdatei des Hubs die Zugangsdaten der Kameras
 * und ist deshalb nur fuer den Hub-Benutzer lesbar (0600). Der Hub laedt sie
 * nur, wenn beim Start der erste Abruf scheitert; sobald die Cloud antwortet,
 * gilt wieder ihre Antwort.
 *
 * Aus der Kopie wird nichts geschaltet: Ein Offenhalten („Tor offen halten“)
 * steht gar nicht darin, und „Lieferdienst: Tor öffnen“ gilt aus der Kopie
 * nur als „melden“, bis die Cloud die Einstellung wieder bestaetigt.
 */

export const CAMERA_CACHE_VERSION = 1;
/** Hoechstes Alter der Kopie in Tagen, gerechnet ab der letzten Antwort der Cloud. */
export const CAMERA_CACHE_MAX_AGE_DAYS = 14;
/**
 * Auch ohne Aenderung wird die Kopie hoechstens so selten neu geschrieben:
 * Ihr Zeitstempel sagt dann, wann die Cloud den Stand zuletzt bestaetigt hat.
 * Ohne das waere eine Liste, die sich zwei Wochen nicht aendert, zu alt.
 */
export const CAMERA_CACHE_REFRESH_MS = 24 * 60 * 60_000;
/** Ein Zeitstempel so weit nach der Uhr des Hubs gilt als unlesbar. */
export const CAMERA_CACHE_FUTURE_SLACK_MS = 24 * 60 * 60_000;

const DAY_MS = 24 * 60 * 60_000;

/** Was der Hub von einem Eintrag mindestens braucht (CameraConfig in cameras.ts). */
export interface CachedCamera {
  id: number;
  name: string;
  kind?: string;
  host: string;
  httpPort: number;
  https: boolean;
  username: string;
  password: string;
  channel: number;
  deliveryMode?: string | null;
  doorHoldUntil?: string | null;
}

export interface CameraCacheFile<T extends CachedCamera = CachedCamera> {
  version: number;
  /** Zeitpunkt der Antwort der Cloud (ISO). */
  savedAt: string;
  cameras: T[];
}

/** Was zuletzt geschrieben wurde: Inhalt (ohne Zeitstempel) und Zeitpunkt. */
export interface CacheStamp {
  content: string;
  savedAt: number;
}

export type CacheCheck<T extends CachedCamera> =
  | { ok: true; savedAt: number; cameras: T[] }
  | { ok: false; reason: string };

/**
 * Inhalt der Kopie aus der Antwort der Cloud: ohne Offenhalten. Es ist ein
 * Zustand, kein Teil der Einrichtung, und laeuft nach Minuten oder Stunden
 * ab; ohne das Feld schreibt der Hub die Datei auch nicht bei jedem Start
 * oder Ende eines Offenhaltens neu.
 */
export function cacheContent<T extends CachedCamera>(cameras: T[]): T[] {
  return cameras.map((c) => {
    const copy = { ...c };
    delete copy.doorHoldUntil;
    return copy;
  });
}

/** Text der Datei. */
export function cacheFileText<T extends CachedCamera>(cameras: T[], savedAt: number): string {
  const file: CameraCacheFile<T> = {
    version: CAMERA_CACHE_VERSION,
    savedAt: new Date(savedAt).toISOString(),
    cameras: cacheContent(cameras),
  };
  return JSON.stringify(file, null, 2);
}

/** Vergleichbarer Inhalt (ohne Zeitstempel). */
export function cacheContentKey<T extends CachedCamera>(cameras: T[]): string {
  return JSON.stringify(cacheContent(cameras));
}

/**
 * Neu schreiben, wenn sich der Inhalt geaendert hat (oder noch keine lesbare
 * Kopie da ist) und sonst einmal am Tag, damit das Alter stimmt.
 */
export function cacheWriteDue(prev: CacheStamp | null, content: string, now: number): boolean {
  if (!prev) return true;
  if (prev.content !== content) return true;
  return now - prev.savedAt >= CAMERA_CACHE_REFRESH_MS || now < prev.savedAt;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validCamera(v: unknown): boolean {
  if (!isObject(v)) return false;
  return (
    Number.isInteger(v.id) &&
    (v.id as number) > 0 &&
    typeof v.name === "string" &&
    (v.kind === undefined || v.kind === null || typeof v.kind === "string") &&
    typeof v.host === "string" &&
    Number.isInteger(v.httpPort) &&
    (v.httpPort as number) > 0 &&
    (v.httpPort as number) <= 65535 &&
    typeof v.https === "boolean" &&
    typeof v.username === "string" &&
    typeof v.password === "string" &&
    Number.isInteger(v.channel) &&
    (v.channel as number) >= 0
  );
}

/** Aufbau pruefen; null, wenn die Datei nicht so aussieht, wie der Hub sie schreibt. */
function parseCacheFile<T extends CachedCamera>(raw: unknown): { savedAt: number; cameras: T[] } | null {
  if (!isObject(raw)) return null;
  if (raw.version !== CAMERA_CACHE_VERSION) return null;
  if (typeof raw.savedAt !== "string") return null;
  const savedAt = Date.parse(raw.savedAt);
  if (!Number.isFinite(savedAt)) return null;
  if (!Array.isArray(raw.cameras) || !raw.cameras.every(validCamera)) return null;
  const ids = new Set(raw.cameras.map((c) => (c as CachedCamera).id));
  if (ids.size !== raw.cameras.length) return null;
  return { savedAt, cameras: raw.cameras as T[] };
}

/** Stand einer vorhandenen Datei fuer cacheWriteDue (null: keine lesbare Kopie). */
export function cacheStamp(raw: unknown): CacheStamp | null {
  const parsed = parseCacheFile(raw);
  return parsed ? { content: cacheContentKey(parsed.cameras), savedAt: parsed.savedAt } : null;
}

/**
 * Darf der Hub mit dieser Kopie (geparstes JSON der Datei) weiterarbeiten?
 * Das Alter kommt aus dem Zeitstempel in der Datei, nicht aus der Dateizeit.
 * Beschaedigt, zu alt oder mit einem Zeitstempel weit nach der Uhr des Hubs:
 * nein, mit dem Grund fuer die Log-Zeile. Sonst die Eintraege so, wie der
 * Hub sie verwendet: ohne Offenhalten, Lieferdienst hoechstens „melden“.
 */
export function usableCache<T extends CachedCamera>(kopie: unknown, jetzt: number, maxAlterTage: number): CacheCheck<T> {
  const parsed = parseCacheFile<T>(kopie);
  if (!parsed) return { ok: false, reason: "beschädigt" };
  if (parsed.savedAt - jetzt > CAMERA_CACHE_FUTURE_SLACK_MS) return { ok: false, reason: "Zeitstempel liegt in der Zukunft" };
  if (!(maxAlterTage > 0) || jetzt - parsed.savedAt > maxAlterTage * DAY_MS) {
    return { ok: false, reason: `älter als ${maxAlterTage} Tage` };
  }
  const cameras = parsed.cameras.map((c) => ({
    ...c,
    doorHoldUntil: null,
    ...(c.deliveryMode === "OPEN" ? { deliveryMode: "NOTIFY" } : {}),
  }));
  return { ok: true, savedAt: parsed.savedAt, cameras };
}
