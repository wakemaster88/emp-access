/**
 * Belegung und Wartezeit (nur Logik, ohne Kamera/Tracker/Cloud).
 *
 * Ein „Punkt“ (Spot) ist eine Stelle, an der sich Gaeste stauen koennen:
 * Uebungslift, Seilbahn A/B, Gastro, Drehkreuz. Jeder Punkt hat Kameras
 * (per Namensmuster), eine Schwelle „voll“ (Personen im Bild bzw. in der
 * Zone) und einen Durchsatz pro Stunde. Ist ein Drehkreuz-Bereich
 * zugeordnet, ersetzt der gemessene Durchsatz (Eintritte der letzten Stunde)
 * den eingestellten, sobald genug Betrieb ist.
 *
 * Wartezeit ≈ Personen / Durchsatz. Das ist bewusst grob: Die Kamera sieht
 * auch Zuschauer und Leute, die nur herumstehen. Mit einer Zone je Kamera
 * (nur der Wartebereich) und eigenen Schwellen in hub/occupancy.json wird
 * es genauer.
 */

export interface Point {
  x: number;
  y: number;
}

export interface SpotConfig {
  key: string;
  name: string;
  /** Regulaerer Ausdruck (ohne Schraegstriche, case-insensitiv) auf den Kameranamen. */
  cameras: string;
  /** Ab so vielen Personen gilt der Punkt als voll. */
  full: number;
  /** Abfertigung pro Stunde (Fahrten, Gaeste an der Theke, Durchgaenge). */
  perHour: number;
  /** Ab dieser Wartezeit (min) wird gemeldet, auch wenn „voll“ noch nicht erreicht ist. */
  waitAlertMin: number;
  /** Drehkreuz-Bereich (Muster auf den Bereichsnamen) fuer den gemessenen Durchsatz. */
  area?: string;
  /** Normierte Zone (0..1) je Kamera-ID: nur Personen mit Mittelpunkt darin zaehlen. */
  zones?: Record<string, Point[]>;
  enabled?: boolean;
}

export const DEFAULT_SPOTS: SpotConfig[] = [
  { key: "uebungslift", name: "Übungslift", cameras: "übungslift|uebungslift", full: 12, perHour: 60, waitAlertMin: 15 },
  { key: "seilbahn-a", name: "Seilbahn A", cameras: "seilbahn a", full: 25, perHour: 100, waitAlertMin: 20, area: "seilbahn a" },
  { key: "seilbahn-b", name: "Seilbahn B", cameras: "seilbahn b", full: 25, perHour: 100, waitAlertMin: 20, area: "seilbahn b" },
  { key: "gastro", name: "Gastro", cameras: "gastro|imbiss", full: 15, perHour: 40, waitAlertMin: 15 },
  { key: "drehkreuz", name: "Drehkreuz", cameras: "drehkreuz", full: 10, perHour: 120, waitAlertMin: 10, area: "seilbahn a" },
];

/** Gemessener Durchsatz zaehlt erst ab so vielen Eintritten pro Stunde (sonst ist wenig los, nicht langsam). */
export const MIN_MEASURED_PER_HOUR = 20;

/** Eigene Einstellungen (hub/occupancy.json) ueber die Vorgaben legen. */
export function mergeSpots(defaults: SpotConfig[], overrides: unknown): SpotConfig[] {
  const list = Array.isArray(overrides)
    ? overrides
    : overrides && typeof overrides === "object" && Array.isArray((overrides as { spots?: unknown }).spots)
      ? (overrides as { spots: unknown[] }).spots
      : [];
  const out = defaults.map((d) => ({ ...d }));
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Partial<SpotConfig>;
    const key = typeof o.key === "string" ? o.key.trim() : "";
    if (!key) continue;
    let spot = out.find((s) => s.key === key);
    if (!spot) {
      if (typeof o.name !== "string" || typeof o.cameras !== "string") continue;
      spot = { key, name: o.name, cameras: o.cameras, full: 10, perHour: 60, waitAlertMin: 15 };
      out.push(spot);
    }
    if (typeof o.name === "string" && o.name.trim()) spot.name = o.name.trim();
    if (typeof o.cameras === "string" && o.cameras.trim() && safeRegex(o.cameras)) spot.cameras = o.cameras.trim();
    if (posNum(o.full)) spot.full = Number(o.full);
    if (posNum(o.perHour)) spot.perHour = Number(o.perHour);
    if (posNum(o.waitAlertMin)) spot.waitAlertMin = Number(o.waitAlertMin);
    if (typeof o.area === "string") spot.area = o.area.trim() || undefined;
    if (o.enabled === false || o.enabled === true) spot.enabled = o.enabled;
    if (o.zones && typeof o.zones === "object") {
      const zones: Record<string, Point[]> = {};
      for (const [cam, pts] of Object.entries(o.zones)) {
        const poly = Array.isArray(pts) ? pts.map(toPoint).filter((p): p is Point => p != null) : [];
        if (poly.length >= 3) zones[cam] = poly;
      }
      spot.zones = zones;
    }
  }
  return out;
}

function posNum(v: unknown): boolean {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

function toPoint(p: unknown): Point | null {
  if (Array.isArray(p) && p.length >= 2) {
    const x = Number(p[0]);
    const y = Number(p[1]);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }
  if (p && typeof p === "object") {
    const x = Number((p as Point).x);
    const y = Number((p as Point).y);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }
  return null;
}

export function safeRegex(src: string): RegExp | null {
  try {
    return new RegExp(src, "i");
  } catch {
    return null;
  }
}

/** Kameras eines Punkts (DoorBirds nicht: die schauen aufs Tor). */
export function camerasForSpot<T extends { id: number; name: string; kind?: string }>(spot: SpotConfig, cams: T[]): T[] {
  const re = safeRegex(spot.cameras);
  if (!re) return [];
  return cams.filter((c) => (c.kind ?? "REOLINK") !== "DOORBIRD" && re.test(c.name));
}

/** Median der letzten Messungen: einzelne Ausreisser (Gruppe laeuft durchs Bild) zaehlen nicht. */
export function smooth(values: number[], take = 3): number {
  const v = values.slice(-take).sort((a, b) => a - b);
  if (!v.length) return 0;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
}

/** Durchsatz pro Stunde: gemessen am Drehkreuz, wenn genug los ist, sonst eingestellt. */
export function effectivePerHour(spot: SpotConfig, measuredPerHour: number | null): { perHour: number; measured: boolean } {
  if (measuredPerHour != null && measuredPerHour >= MIN_MEASURED_PER_HOUR) {
    return { perHour: measuredPerHour, measured: true };
  }
  return { perHour: spot.perHour, measured: false };
}

/** Geschaetzte Wartezeit in Minuten (ganze Minuten, 0 bei leerem Punkt). */
export function waitMinutes(persons: number, perHour: number): number {
  if (persons <= 0 || perHour <= 0) return 0;
  return Math.round((persons * 60) / perHour);
}

export type Level = "leer" | "ruhig" | "gut besucht" | "voll";

export function levelFor(persons: number, full: number): Level {
  if (persons <= 0) return "leer";
  const r = persons / Math.max(1, full);
  if (r >= 1) return "voll";
  if (r >= 0.5) return "gut besucht";
  return "ruhig";
}

/* ------------------------------------------------------------ Meldungen */

export interface AlertState {
  /** Wie oft hintereinander „kritisch“ gemessen. */
  streak: number;
  /** Gemeldet und noch nicht wieder entspannt. */
  active: boolean;
  lastAlertAt: number;
}

export function newAlertState(): AlertState {
  return { streak: 0, active: false, lastAlertAt: -Infinity };
}

export const ALERT_COOLDOWN_MS = 45 * 60_000;

/**
 * Was mit einer faelligen Meldung geschieht:
 *  - on (Standard): sie geht per Telegram hinaus.
 *  - off: die Meldestufen werden gar nicht ausgewertet.
 *  - shadow (Probelauf): ausgewertet, geloggt und gezaehlt, aber nichts wird
 *    gesendet. So lassen sich geaenderte Schwellen an echten Messungen
 *    pruefen, bevor die Meldungen wieder hinausgehen.
 */
export type AlertMode = "on" | "off" | "shadow";

/**
 * HUB_OCCUPANCY_ALERTS lesen. Fehlt die Variable oder ist sie leer, gilt der
 * Standard „on“. Ein Wert, den der Hub nicht kennt (`known` ist dann false),
 * gilt als Probelauf: Wer etwas eintraegt, wollte nicht den Standard, und ein
 * Tippfehler bei „off“ soll keine Meldungen einschalten.
 */
export function alertMode(raw: string | null | undefined): { mode: AlertMode; known: boolean } {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "") return { mode: "on", known: true };
  if (/^(on|1|true|ja|an|yes)$/.test(v)) return { mode: "on", known: true };
  if (/^(off|0|false|nein|aus|no)$/.test(v)) return { mode: "off", known: true };
  return { mode: "shadow", known: v === "shadow" };
}

/**
 * Teil der Startzeile zu HUB_OCCUPANCY_ALERTS. Ohne Angabe sagt sie, dass der
 * Standard gilt und wie man ihn aendert.
 */
export function alertModeText(raw: string | null | undefined): string {
  const { mode, known } = alertMode(raw);
  if (mode === "on") {
    return (raw ?? "").trim() === "" ? "Meldungen an (Standard; HUB_OCCUPANCY_ALERTS=shadow: nur Log, off: ohne Meldungen)" : "Meldungen an";
  }
  if (mode === "off") return "ohne Meldungen";
  return `Meldungen im Probelauf (nur Log, nichts wird gesendet; einschalten mit HUB_OCCUPANCY_ALERTS=on)${known ? "" : " – Wert von HUB_OCCUPANCY_ALERTS nicht erkannt"}`;
}

/**
 * Was mit einem Ergebnis der Meldestufe geschieht: senden (on), nur loggen
 * und zaehlen (shadow) oder nichts. Gesendet wird ausschliesslich bei „on“.
 */
export function alertAction(mode: AlertMode, step: "alert" | "relaxed" | null): "send" | "log" | null {
  if (!step || mode === "off") return null;
  return mode === "on" ? "send" : "log";
}

/**
 * Meldung, wenn zweimal hintereinander voll (oder Wartezeit ueber der
 * Schwelle). Danach Ruhe, bis es deutlich leerer ist (unter 70 % von voll
 * und unter 70 % der Wartezeit-Schwelle) – dann „entspannt“.
 */
export function stepAlert(
  st: AlertState,
  m: { persons: number; full: number; wait: number; waitAlertMin: number },
  now: number,
): "alert" | "relaxed" | null {
  const critical = m.persons >= m.full || m.wait >= m.waitAlertMin;
  const calm = m.persons < m.full * 0.7 && m.wait < m.waitAlertMin * 0.7;
  if (critical) {
    st.streak++;
    if (!st.active && st.streak >= 2 && now - st.lastAlertAt >= ALERT_COOLDOWN_MS) {
      st.active = true;
      st.lastAlertAt = now;
      return "alert";
    }
    return null;
  }
  st.streak = 0;
  if (st.active && calm) {
    st.active = false;
    return "relaxed";
  }
  return null;
}

/**
 * "9-21" → Messung von 9:00 bis 20:59. Ungueltig/leer = immer. Ist die Stunde
 * keine endliche Zahl, wird nicht gemessen.
 */
export function inHours(spec: string, hour: number): boolean {
  if (!Number.isFinite(hour)) return false;
  const m = spec.trim().match(/^(\d{1,2})-(\d{1,2})$/);
  if (!m) return true;
  const from = Number(m[1]);
  const to = Number(m[2]);
  if (from === to) return true;
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

/**
 * Sind alle Raeume, in denen die Kameras eines Punkts haengen, laut
 * Betriebszeit zu? Dann misst der Takt dort nicht: niemand wartet, und ein
 * Mitarbeiter am Lift soll keine „wird voll“-Meldung ausloesen. Kameras ohne
 * Raum oder Raeume ohne Betriebszeit zaehlen als offen (wie bisher nur das
 * feste Fenster HUB_OCCUPANCY_HOURS).
 */
export function spotClosed(
  cameraIds: number[],
  rooms: Array<{ cameras: Array<{ id: number }>; operating: { open: boolean } | null }>,
): boolean {
  if (cameraIds.length === 0) return false;
  return cameraIds.every((id) => {
    const own = rooms.filter((r) => r.cameras.some((c) => c.id === id));
    return own.length > 0 && own.every((r) => r.operating != null && r.operating.open === false);
  });
}

/** Ein Satz je Punkt fuer Telegram. */
export function spotLine(s: { name: string; persons: number; level: Level; wait: number; partial?: boolean }): string {
  const who = s.persons === 1 ? "1 Person" : `${s.persons} Personen`;
  const wait = s.wait > 0 ? `, Wartezeit ca. ${s.wait} min` : "";
  return `${s.name}: ${s.level} (${who}${wait})${s.partial ? " – nicht alle Kameras erreichbar" : ""}`;
}

/**
 * Log-Zeile zur ersten Messung eines Tages: wie viele Bereiche gemessen
 * wurden und wie viele Personen dort zusammen zu sehen waren. Die weiteren
 * Messungen des Tages bekommen keine Zeile. Ein Bereich zaehlt als gemessen,
 * wenn mindestens eine seiner Kameras ein Ergebnis geliefert hat (oder er
 * keine Kamera hat und nur ueber das Drehkreuz laeuft).
 *
 * `resting` = Bereiche, die der Takt auslaesst, weil ihre Raeume zu sind.
 * `again` = fuer heute liegen schon Messwerte vor (der Hub wurde im Lauf des
 * Tages neu gestartet, oder es wurde vor dem Takt auf Nachfrage gemessen).
 */
export function dayStartLine(
  readings: Array<{ persons: number; cameras: Array<{ persons: number | null }> }>,
  resting: number,
  again = false,
): string {
  const blind = readings.filter((r) => r.cameras.length > 0 && r.cameras.every((c) => c.persons == null));
  const measured = readings.filter((r) => !blind.includes(r));
  const persons = measured.reduce((sum, r) => sum + r.persons, 0);
  const areas = (n: number) => (n === 1 ? "1 Bereich" : `${n} Bereiche`);
  const notes = [
    resting > 0 ? `${areas(resting)} ${resting === 1 ? "ruht" : "ruhen"}, Räume geschlossen` : "",
    blind.length > 0 ? `${areas(blind.length)} ohne Kamerabild` : "",
  ].filter(Boolean);
  return (
    `Belegung: ${again ? "Messung heute fortgesetzt" : "erste Messung heute"}: ${areas(measured.length)}, ` +
    `${persons === 1 ? "1 Person" : `${persons} Personen`}` +
    (notes.length ? ` (${notes.join("; ")})` : "")
  );
}
