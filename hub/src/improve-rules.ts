/**
 * Regeln der Hub-Diagnose (ohne I/O, testbar): Hinweise aus den Zählern,
 * Fehler in Folge je Vorgang und Tagessummen, die einen Neustart
 * überstehen. improve-log.ts zählt, schreibt und ruft diese Regeln.
 */

/* ---------------------------------------------------------------------------
 * Fehler in Folge
 * ------------------------------------------------------------------------- */

/** Fehler in Folge und letzter Fehlertext eines wiederkehrenden Vorgangs. */
export interface FailTrail {
  streak: number;
  /** Letzter Fehlertext (bleibt nach einem Erfolg stehen, für den Hinweis). */
  last: string | null;
}

export function newTrail(): FailTrail {
  return { streak: 0, last: null };
}

/** Ausgang eines Laufs anwenden: `error` = Fehlertext, null = Erfolg (setzt die Folge zurück). */
export function trailStep(trail: FailTrail, error: string | null): FailTrail {
  if (error === null) return { streak: 0, last: trail.last };
  return { streak: trail.streak + 1, last: error.length > 160 ? `${error.slice(0, 160)}…` : error };
}

/* ---------------------------------------------------------------------------
 * Fehleranteil
 * ------------------------------------------------------------------------- */

/** Ab diesem Anteil der Fehler an allen Läufen … */
export const HINT_MIN_SHARE = 0.02;
/** … und mindestens so vielen Fehlern gibt es einen Hinweis. */
export const HINT_MIN_FAILS = 5;
/** So viele Fehler in Folge geben immer einen Hinweis, bis der nächste Lauf gelingt. */
export const HINT_STREAK = 3;

export interface FailRate {
  fails: number;
  total: number;
  trail?: FailTrail;
}

/**
 * Fällt ein Vorgang auffällig oft aus? Fehleranteil ab 2 % bei mindestens 5
 * Fehlern, oder 3 Fehler in Folge. Einzelne Aussetzer in vielen tausend
 * Läufen geben keinen Hinweis.
 */
export function failRateDue(r: FailRate): boolean {
  if ((r.trail?.streak ?? 0) >= HINT_STREAK) return true;
  const total = Math.max(r.total, r.fails);
  return r.fails >= HINT_MIN_FAILS && total > 0 && r.fails / total >= HINT_MIN_SHARE;
}

function percent(share: number): string {
  const p = share * 100;
  return `${p.toLocaleString("de-DE", { maximumFractionDigits: p < 10 ? 1 : 0 })} %`;
}

/** „60 von 1.000 (6 %), 3 in Folge, zuletzt: …“ */
export function failRateText(r: FailRate, what: string): string {
  const total = Math.max(r.total, r.fails);
  const parts = [`${r.fails} von ${total.toLocaleString("de-DE")} ${what} (${percent(total > 0 ? r.fails / total : 0)})`];
  if ((r.trail?.streak ?? 0) >= HINT_STREAK) parts.push(`${r.trail!.streak} in Folge`);
  if (r.trail?.last) parts.push(`zuletzt: ${r.trail.last}`);
  return parts.join(", ");
}

/* ---------------------------------------------------------------------------
 * Hinweise
 * ------------------------------------------------------------------------- */

export type Counts = Readonly<Record<string, number>>;

/** Schlüssel der Fehlerfolge je Vorgang (improveOutcome in improve-log.ts). */
export const TRAIL_NOPARKING = "noparking.fail";
export const TRAIL_TRACKER = "tracker.fail";

export interface HintContext {
  /** Hinweise zum Mac selbst (Auto-Login, Einschaltplan): Sie stehen vorn. */
  system?: readonly string[];
  /** Hinweis zu Beinahe-Treffern der Gesichtserkennung (face-rules.ts). */
  nearMiss?: string | null;
  /** Fehler in Folge und letzter Fehlertext je Vorgang. */
  trails?: Readonly<Record<string, FailTrail>>;
  /** Zeitlimit eines Tracker-Aufrufs in Sekunden (für den Text). */
  trackerTimeoutSec?: number;
}

/**
 * Aufrufe des Trackers (tracker-client.ts zählt `tracker.<Aufrufer>.ok` und
 * `.fail`). Vergleichsaufrufe (Aufrufer mit `_shadow`) zählen nicht mit: Sie
 * verändern auch den Ausfallschalter nicht.
 */
export function trackerCalls(counts: Counts): { ok: number; fail: number } {
  let ok = 0;
  let fail = 0;
  for (const [key, value] of Object.entries(counts)) {
    const m = /^tracker\.(.+)\.(ok|fail)$/.exec(key);
    if (!m || m[1].endsWith("_shadow")) continue;
    if (m[2] === "ok") ok += value;
    else fail += value;
  }
  return { ok, fail };
}

/** Hinweise aus den Zählern der Sitzung, die wichtigsten zuerst. */
export function hintsFor(counts: Counts, ctx: HintContext = {}): string[] {
  const n = (key: string): number => counts[key] ?? 0;
  const trails = ctx.trails ?? {};
  const out: string[] = [];
  // Zuerst der Mac selbst: ohne Auto-Login und Einschaltplan ist alles andere egal.
  for (const h of ctx.system ?? []) out.push(h);
  const personOk = n("face.person_match") + n("face.person_nomatch");
  const skipNoFace = n("face.skip_no_face");
  const personPipelines = personOk + skipNoFace + n("face.skip_inactive") + n("face.skip_inflight");
  const embedHit = n("face.ok") + n("face.zoom") + n("face.keep");
  if (personPipelines >= 6 && skipNoFace / personPipelines >= 0.5) {
    out.push(`Personen-Pipeline oft ohne Gesicht (${skipNoFace}/${personPipelines}) – Abstand, Licht oder Zoom`);
  }
  if (n("face.keep") >= 5 && n("face.zoom") === 0) {
    out.push("Face-Zoom findet Mini-Gesichter nicht – KEEP-Fallback trägt, Matching unsicher");
  }
  if (ctx.nearMiss) out.push(ctx.nearMiss);
  if (embedHit >= 3 && n("face.person_match") === 0 && n("face.person_nomatch") >= 3 && n("face.near_miss") === 0) {
    out.push("Gesichter da, kein Match – Unbekannte oder Mini-Gesichter (best-Score im Log)");
  }
  const tracker = trackerCalls(counts);
  const trackerRate = { fails: tracker.fail, total: tracker.ok + tracker.fail, trail: trails[TRAIL_TRACKER] };
  if (failRateDue(trackerRate)) {
    const timeout = ctx.trackerTimeoutSec ? `, ${ctx.trackerTimeoutSec} s` : "";
    out.push(
      `YOLO-Tracker (/classify) schlägt fehl: ${failRateText(trackerRate, "Aufrufen")} – Dienst auf 8088, PIN oder Zeitlimit (HUB_VISION_TIMEOUT_MS${timeout})`,
    );
  }
  if (n("vision.no_small") >= 5 && n("vision.no_small") > 2 * n("vision.yes")) {
    out.push(
      "Fahrzeug-Alarme ohne Auto an der Einfahrt – Kamera-KI reagiert auf Hintergrundverkehr (Erkennungszone in der Kamera enger ziehen)",
    );
  }
  const noparkRate = { fails: n("noparking.fail"), total: n("noparking.run"), trail: trails[TRAIL_NOPARKING] };
  if (failRateDue(noparkRate)) {
    out.push(`Halteverbot-Prüfung schlägt fehl: ${failRateText(noparkRate, "Durchläufen")} – Kamera erreichbar, Bild abrufbar?`);
  }
  if (n("noparking.waiting") >= 20 && n("noparking.alert") === 0) {
    out.push("Dauerbelegung im Halteverbot ohne Meldung – stehen dort eigene Fahrzeuge? (HUB_NOPARK_ZONE enger ziehen)");
  }
  if (n("camera.talk_fail") >= 2) {
    out.push("Ansage über den Kamera-Lautsprecher scheitert – LAN oder RTSP-Backchannel der Kamera");
  }
  if (n("alpr.repeat") >= 5) {
    out.push("Kennzeichen mehrfach kurz hintereinander – Alarm flackert, HUB_VEHICLE_GRACE_FRAMES prüfen");
  }
  if (n("alpr.skip") >= 4 && n("alpr.plate") === 0) {
    out.push("Fahrzeug-Bursts ohne Plate – Zufahrt/OCR oder Fehlalarm der Kamera-KI");
  }
  if (n("task.stale") >= 1) {
    out.push("SCAN_SNAPSHOT stale (>30 s) – Hub war beschäftigt oder offline");
  }
  if (n("task.fail") >= 2) {
    out.push(`Tasks fehlgeschlagen: ${n("task.fail")} – Queue/API prüfen`);
  }
  if (n("doorbird.monitor_drop") >= 2) {
    out.push("DoorBird-Monitor bricht ab – LAN oder Idle-Timeout");
  }
  if (n("parking.tracker_down") >= 2) {
    out.push("Park-Tracker offline – YOLO-Dienst auf 8088");
  }
  if (n("heartbeat.fail") >= 3) {
    out.push("Heartbeat zur Cloud unzuverlässig");
  }
  if (n("follow.home_fail") >= 1) {
    out.push("Schwenk-Kamera fand nach dem Folgen nicht in die Grundstellung – Wachposition prüfen");
  }
  if (n("follow.no_home") >= 1) {
    out.push("Schwenk-Kamera ohne Grundstellung folgt nicht – Wachposition setzen oder Preset „Grundstellung“ anlegen");
  }
  if (out.length === 0) out.push("Keine auffälligen Raten in dieser Session");
  return out;
}

/* ---------------------------------------------------------------------------
 * Tagessummen
 * ------------------------------------------------------------------------- */

/** Zähler je Tag (Ortszeit), `{ "2026-11-26": { "noparking.clear": 4000, … } }`. */
export type DailyCounts = Record<string, Record<string, number>>;

/** So viele Tage bleiben in hub/.cache/improve-daily.json. */
export const DAILY_KEEP_DAYS = 14;

/** Tag in Ortszeit (Europe/Berlin) als JJJJ-MM-TT. */
export function localDay(at: Date): string {
  return at.toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
}

/** Zähler zum Tag addieren (ändert `daily`). */
export function addDaily(daily: DailyCounts, day: string, key: string, by: number): void {
  const today = (daily[day] ??= {});
  today[key] = (today[key] ?? 0) + by;
}

/** Zwei Stände zusammenführen (die gespeicherten und die seit dem Start gezählten). */
export function mergeDaily(a: DailyCounts, b: DailyCounts): DailyCounts {
  const out: DailyCounts = {};
  for (const src of [a, b]) {
    for (const [day, counts] of Object.entries(src)) {
      for (const [key, value] of Object.entries(counts)) addDaily(out, day, key, value);
    }
  }
  return out;
}

/** Nur die letzten `keep` Tage behalten. */
export function pruneDaily(daily: DailyCounts, keep = DAILY_KEEP_DAYS): DailyCounts {
  const days = Object.keys(daily).sort().slice(-keep);
  return Object.fromEntries(days.map((d) => [d, daily[d]]));
}

/** Gespeicherte Tagessummen lesen; Unlesbares ergibt einen leeren Stand. */
export function parseDaily(raw: string): DailyCounts {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return {};
  }
  const days = json && typeof json === "object" ? (json as { days?: unknown }).days : null;
  if (!days || typeof days !== "object" || Array.isArray(days)) return {};
  const out: DailyCounts = {};
  for (const [day, counts] of Object.entries(days as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !counts || typeof counts !== "object" || Array.isArray(counts)) continue;
    for (const [key, value] of Object.entries(counts as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value) && value > 0) addDaily(out, day, key, value);
    }
  }
  return pruneDaily(out);
}

export function serializeDaily(daily: DailyCounts): string {
  return JSON.stringify({ version: 1, days: pruneDaily(daily) });
}
