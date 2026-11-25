/**
 * Fahrzeugliste am Hub (reine Logik, testbar): wie alt sie ist, wann die
 * Kennzeichen-Suche auf einen Abruf wartet und wann sie nicht mehr schalten
 * darf.
 *
 * Die Liste kommt alle 5 min aus der Cloud und liegt zusätzlich in
 * .cache/allowed-vehicles.json für den Betrieb ohne Cloud. Wie lange sie ohne
 * Cloud weiter schalten darf, ist eine Entscheidung vom 25.11.2026: 7 Tage
 * (HUB_WHITELIST_MAX_AGE_H). Danach öffnet kein Kennzeichen mehr Tor, Tür oder
 * Shelly, bis ein Abruf wieder gelingt; Erkennung, Sichtungen und Anzeige
 * laufen weiter.
 */

/** Standard für HUB_WHITELIST_MAX_AGE_H: 7 Tage. */
export const WHITELIST_MAX_AGE_H_DEFAULT = 168;

/**
 * HUB_WHITELIST_MAX_AGE_H in Millisekunden. 0 = unbegrenzt; leer, keine Zahl
 * oder negativ ergibt den Standard (168 h).
 */
export function whitelistMaxAgeMs(env: string | undefined): number {
  const raw = (env ?? "").trim();
  const h = raw === "" ? Number.NaN : Number(raw);
  if (!Number.isFinite(h) || h < 0) return WHITELIST_MAX_AGE_H_DEFAULT * 3_600_000;
  return Math.round(h * 3_600_000);
}

/** Bis zu diesem Alter gilt die Liste als frisch (drei Abruf-Takte). */
export const WHITELIST_FRESH_MS = 15 * 60_000;

/**
 * Zustand der Liste nach dem letzten GELUNGENEN Abruf:
 * - `fresh`: höchstens `freshMs` alt, der Abruf läuft normal;
 * - `old`: älter, aber noch nutzbar (Cloud nicht erreichbar);
 * - `stale`: älter als `maxAgeMs` – kein Kennzeichen schaltet mehr.
 * `maxAgeMs` 0 = unbegrenzt. Ohne bekannten Abruf (`lastOkAt` null) gilt
 * die Liste als zu alt, sobald es ein Höchstalter gibt. Ein Zeitpunkt in
 * der Zukunft (Uhr verstellt) zählt als frisch.
 */
export function whitelistState(s: {
  now: number;
  lastOkAt: number | null;
  maxAgeMs: number;
  freshMs?: number;
}): "fresh" | "old" | "stale" {
  if (s.lastOkAt == null || !Number.isFinite(s.lastOkAt)) return s.maxAgeMs > 0 ? "stale" : "old";
  const age = s.now - s.lastOkAt;
  if (s.maxAgeMs > 0 && age > s.maxAgeMs) return "stale";
  return age <= (s.freshMs ?? WHITELIST_FRESH_MS) ? "fresh" : "old";
}

/**
 * Wartet die Kennzeichen-Suche eines Bilds auf einen Abruf der Liste?
 * - Keine Liste (Start ohne Cache-Datei): abrufen und warten, bis er fertig ist.
 * - Liste jünger als `ttlMs`: nichts tun.
 * - In den `retryMs` nach einem gescheiterten Abruf: weder abrufen noch
 *   warten; der Abruf läuft dann nur im Hintergrund (alle 5 min).
 * - Sonst gemeinsamer Abruf: Läuft schon einer (`fetchStartedAt`), wird er
 *   mitbenutzt. Gewartet wird nur bis `maxWaitMs` nach seinem Beginn, für
 *   alle Bilder zusammen: Hängt die Verbindung, kostet das den Burst
 *   höchstens einmal `maxWaitMs`, nicht jedes Bild aufs Neue.
 * `waitMs` Infinity = bis zum Ende des Abrufs.
 */
export function whitelistWait(s: {
  now: number;
  hasList: boolean;
  loadedAt: number;
  ttlMs: number;
  /** Letzter gescheiterter Abruf (0 = keiner seit dem letzten gelungenen). */
  failedAt: number;
  retryMs: number;
  maxWaitMs: number;
  /** Beginn des laufenden Abrufs (null = keiner läuft). */
  fetchStartedAt?: number | null;
}): { fetch: boolean; waitMs: number } {
  if (!s.hasList) return { fetch: true, waitMs: Number.POSITIVE_INFINITY };
  if (s.now - s.loadedAt <= s.ttlMs) return { fetch: false, waitMs: 0 };
  if (s.failedAt > 0 && s.now - s.failedAt < s.retryMs) return { fetch: false, waitMs: 0 };
  if (s.fetchStartedAt != null) {
    return { fetch: true, waitMs: Math.max(0, Math.min(s.maxWaitMs, s.fetchStartedAt + s.maxWaitMs - s.now)) };
  }
  return { fetch: true, waitMs: s.maxWaitMs };
}

/**
 * Beim Nachladen je Fahrzeug den neueren Schaltzeitpunkt behalten: Der Hub
 * merkt sich eine lokale Öffnung sofort, die Cloud erst mit dem Upload der
 * Sichtung (oder gar nicht, wenn er scheitert). Ohne das vergäße ein
 * Nachladen dazwischen die Sperrzeit des Fahrzeugs. Zuordnung über die ID.
 *
 * Ein lokaler Zeitpunkt, der mehr als `maxAheadMs` nach `now` liegt, stammt
 * von einer Uhr, die vorging und inzwischen gestellt ist: Er zählt nicht,
 * es gilt der Wert der Cloud. Sonst sperrte er das Fahrzeug, bis die echte
 * Zeit ihn einholt, und das Nachladen hebe das nie auf.
 */
export const TRIGGERED_MAX_AHEAD_MS = 5 * 60_000;

export function mergeTriggeredAt<T extends { id: number; lastTriggeredAt: number | null }>(
  prev: ReadonlyArray<{ id: number; lastTriggeredAt: number | null }>,
  next: T[],
  now: number,
  maxAheadMs = TRIGGERED_MAX_AHEAD_MS
): T[] {
  const local = new Map<number, number>();
  for (const v of prev) {
    if (v.lastTriggeredAt != null && v.lastTriggeredAt - now <= maxAheadMs) local.set(v.id, v.lastTriggeredAt);
  }
  return next.map((v) => {
    const mine = local.get(v.id);
    if (mine == null || (v.lastTriggeredAt != null && v.lastTriggeredAt >= mine)) return v;
    return { ...v, lastTriggeredAt: mine };
  });
}

/**
 * Quelle der Meldung „Fahrzeugliste zu alt“ in der Cloud, je Hub: Die Cloud
 * schließt, was eine Quelle nicht mehr meldet; ein zweiter Hub am selben
 * Konto darf den Befund eines anderen nicht schließen. Erlaubt sind dort
 * Kleinbuchstaben, Ziffern und Bindestrich, höchstens 32 Zeichen.
 */
export function staleAlertSource(hubName: string): string {
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
  return slug ? `fahrzeugliste-${slug}` : "fahrzeugliste";
}

/**
 * Meldung „Fahrzeugliste zu alt“ an die Cloud (POST /api/hub/alerts, dort
 * Push und Telegram): Was ist jetzt zu senden?
 * - `open`: Die Liste ist zu alt, die Cloud hat die Meldung noch nicht.
 * - `resolve`: Die Liste ist wieder frisch, und die Meldung kann in der Cloud
 *   noch offen sein (gemeldet, oder nach einem Neustart unbekannt). Die
 *   Cloud schickt dann die Entwarnung; war nichts offen, schickt sie nichts.
 * - null: Die Cloud hat schon den richtigen Stand, oder ein Versuch ist
 *   noch keine `retryMs` her gescheitert.
 */
export function staleAlertStep(s: {
  stale: boolean;
  /** Was die Cloud bestätigt hat: true = offen, false = nichts offen, null = unbekannt (nach dem Start). */
  reported: boolean | null;
  now: number;
  /** Letzter gescheiterter Versuch (0 = keiner seit dem letzten gelungenen). */
  failedAt: number;
  retryMs: number;
}): "open" | "resolve" | null {
  if (s.reported === s.stale) return null;
  if (s.failedAt > 0 && s.now - s.failedAt < s.retryMs) return null;
  return s.stale ? "open" : "resolve";
}

/**
 * Letzter gelungener Abruf laut Cache-Datei: das Feld `fetchedAt`; fehlt es
 * (Datei eines älteren Hubs), zählt die Änderungszeit der Datei.
 */
export function cacheOkAt(s: { fetchedAt: unknown; mtimeMs: number | null }): number | null {
  if (typeof s.fetchedAt === "number" && Number.isFinite(s.fetchedAt) && s.fetchedAt > 0) return s.fetchedAt;
  return s.mtimeMs != null && Number.isFinite(s.mtimeMs) ? s.mtimeMs : null;
}

/**
 * Die Cache-Datei wird nach einem gelungenen Abruf geschrieben, wenn sich die
 * Liste geändert hat oder der gespeicherte Abruf-Zeitpunkt älter als
 * `stampMs` ist. So stimmt das Alter nach einem Neustart ohne Cloud auf
 * `stampMs` genau, und die Datei wird nicht bei jedem Abruf geschrieben.
 */
export function cacheWriteDue(s: {
  changed: boolean;
  now: number;
  /** Abruf-Zeitpunkt, der in der Datei steht (null = noch keiner geschrieben). */
  persistedOkAt: number | null;
  stampMs: number;
}): boolean {
  if (s.changed || s.persistedOkAt == null) return true;
  return s.now - s.persistedOkAt >= s.stampMs;
}

/** Dauer für „seit …“ und „Stand vor …“ (Dativ): „3 Minuten“, „1 Stunde“, „7 Tagen“. */
export function agoText(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60_000);
  if (min < 1) return "weniger als einer Minute";
  if (min < 120) return min === 1 ? "1 Minute" : `${min} Minuten`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} Stunden`;
  const d = Math.floor(h / 24);
  return `${d} Tagen`;
}
