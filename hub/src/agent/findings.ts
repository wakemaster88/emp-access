/**
 * Waechter-Logik: aus wiederholten Pruefungen Meldungen machen.
 *
 * Ein Befund wird erst gemeldet, wenn er in `confirm` aufeinanderfolgenden
 * Pruefungen da war (eine Kamera, die einmal nicht antwortet, ist kein
 * Alarm). Entwarnung gibt es nur fuer Befunde, die vorher gemeldet wurden.
 * In der Ruhezeit warten Warnungen bis zum Morgen (watchStep).
 *
 * Der Stand (gemeldete Befunde, zurueckgestellte Meldungen, Entwarnungen,
 * die noch niemanden erreicht haben) laesst sich speichern und nach einem
 * Neustart des Hubs wiederherstellen (serializeWatch, restoreWatch): Ein
 * Befund, der schon gemeldet ist, wird dann nicht noch einmal gemeldet, und
 * was waehrend des Neustarts in Ordnung kam, bekommt seine Entwarnung.
 * Reine Logik ohne I/O.
 */

export type FindingSeverity = "warn" | "alert";

export interface Finding {
  key: string;
  severity: FindingSeverity;
  title: string;
  detail?: string;
  /**
   * Ereignis statt Zustand (z. B. ein Alarm, der nicht zugestellt wurde): Es
   * kommt nicht „wieder in Ordnung“. Faellt der Befund weg, gibt es keine
   * Entwarnung.
   */
  event?: boolean;
}

interface Tracked {
  finding: Finding;
  seen: number;
  since: number;
  notified: boolean;
}

/** Entwarnung zu einem Befund, mit der Dauer, die er bestanden hat. */
export type ResolvedFinding = Finding & { sinceMs: number };

export interface WatchState {
  tracked: Map<string, Tracked>;
  /** In der Ruhezeit zurueckgestellte Meldungen: Sie kommen am Morgen, wenn der Befund dann noch besteht. */
  deferred: Finding[];
  /** Entwarnungen, deren Meldung keinen Chat erreicht hat: Sie kommen mit der naechsten Pruefung erneut. */
  unsent: ResolvedFinding[];
}

export function newWatchState(): WatchState {
  return { tracked: new Map(), deferred: [], unsent: [] };
}

export interface WatchDiff {
  opened: Finding[];
  resolved: ResolvedFinding[];
}

export function diffFindings(st: WatchState, current: Finding[], now: number, confirm = 2): WatchDiff {
  const opened: Finding[] = [];
  const resolved: WatchDiff["resolved"] = [];
  const keys = new Set(current.map((f) => f.key));
  for (const f of current) {
    const t = st.tracked.get(f.key) ?? { finding: f, seen: 0, since: now, notified: false };
    t.finding = f;
    t.seen++;
    // Alarme (z. B. Cloud weg) sofort, Warnungen erst nach Bestaetigung.
    const need = f.severity === "alert" ? 1 : confirm;
    if (!t.notified && t.seen >= need) {
      t.notified = true;
      opened.push(f);
    }
    st.tracked.set(f.key, t);
  }
  for (const [key, t] of st.tracked) {
    if (keys.has(key)) continue;
    st.tracked.delete(key);
    if (t.notified && !t.finding.event) resolved.push({ ...t.finding, sinceMs: now - t.since });
  }
  return { opened, resolved };
}

/**
 * Die Meldung zu diesen Befunden hat niemanden erreicht: Sie gelten wieder
 * als nicht gemeldet und kommen bei der naechsten Pruefung erneut, solange
 * sie dann noch bestehen. Liefert, wie viele Befunde das betrifft.
 */
export function unnotify(st: WatchState, keys: Iterable<string>): number {
  let n = 0;
  for (const key of keys) {
    const t = st.tracked.get(key);
    if (!t?.notified) continue;
    t.notified = false;
    n++;
  }
  return n;
}

/** Offene, bereits gemeldete Befunde (fuer Tagesbericht und /status). */
export function openFindings(st: WatchState): Finding[] {
  return [...st.tracked.values()].filter((t) => t.notified).map((t) => t.finding);
}

/* ------------------------------------------------------------ Eine Pruefung */

export interface WatchStep {
  /** Befunde, die jetzt gemeldet werden: neue und am Morgen nachgeholte. */
  announce: Finding[];
  /** Entwarnungen, die jetzt gemeldet werden. */
  resolved: ResolvedFinding[];
  /** In dieser Pruefung fuer den Morgen zurueckgestellt. */
  deferredNow: Finding[];
}

/** So viele Entwarnungen warten hoechstens auf einen neuen Versuch. */
export const UNSENT_MAX = 50;

/**
 * Eine Pruefung des Zustands-Waechters: was jetzt gemeldet wird.
 *  - Alarme sofort, Warnungen nach `confirm` Pruefungen (diffFindings).
 *  - In der Ruhezeit (`quiet`) warten Warnungen bis zum Morgen; Alarme und
 *    Entwarnungen gehen auch dann sofort hinaus.
 *  - Nach der Ruhezeit kommen die zurueckgestellten Meldungen, soweit der
 *    Befund noch besteht. Was in der Ruhezeit kam und wieder ging, wird nicht
 *    gemeldet.
 *  - Entwarnungen, deren Meldung niemanden erreicht hat (`unsent`), kommen
 *    erneut. Ist der Befund inzwischen wieder gemeldet oder zurueckgestellt,
 *    entfaellt die alte Entwarnung.
 */
export function watchStep(st: WatchState, current: Finding[], now: number, quiet: boolean, confirm = 2): WatchStep {
  const diff = diffFindings(st, current, now, confirm);
  const announce: Finding[] = [];
  const deferredNow: Finding[] = [];
  for (const f of diff.opened) {
    if (quiet && f.severity !== "alert") deferredNow.push(f);
    else announce.push(f);
  }
  st.deferred.push(...deferredNow);
  if (!quiet && st.deferred.length) {
    const stillOpen = new Set(openFindings(st).map((f) => f.key));
    announce.unshift(...st.deferred.filter((f) => stillOpen.has(f.key)));
    st.deferred = [];
  }
  const deferredKeys = new Set(st.deferred.map((f) => f.key));
  const resolvedNow = diff.resolved.filter((f) => !deferredKeys.has(f.key));
  st.deferred = st.deferred.filter((f) => !diff.resolved.some((r) => r.key === f.key));
  const fresh = new Set(resolvedNow.map((f) => f.key));
  const again = st.unsent.filter((f) => !st.tracked.get(f.key)?.notified && !fresh.has(f.key));
  st.unsent = [];
  return { announce, resolved: [...again, ...resolvedNow], deferredNow };
}

/**
 * Die Meldung mit diesen Entwarnungen hat niemanden erreicht: Sie kommen mit
 * der naechsten Pruefung erneut (watchStep).
 */
export function keepUnsent(st: WatchState, resolved: ResolvedFinding[]): void {
  for (const r of resolved) {
    if (!st.unsent.some((u) => u.key === r.key)) st.unsent.push(r);
  }
  if (st.unsent.length > UNSENT_MAX) st.unsent = st.unsent.slice(-UNSENT_MAX);
}

/* ------------------------------------------------------------ Texte */

const minutes = (ms: number) => Math.max(1, Math.round(ms / 60_000));

/** Zeile der Meldung zu einem Befund: Alarm mit ‼️, Warnung mit ⚠️, die Einzelheit eingerueckt darunter. */
export function announceLine(f: Finding): string {
  return `${f.severity === "alert" ? "‼️" : "⚠️"} ${f.title}${f.detail ? `\n   ${f.detail}` : ""}`;
}

/** Zeile der Meldung zu einer Entwarnung. */
export function resolvedLine(f: ResolvedFinding): string {
  return `✅ Wieder in Ordnung: ${f.title} (nach ${minutes(f.sinceMs)} min)`;
}

/**
 * Log-Zeilen zu einer Pruefung: je gemeldetem Befund, je Entwarnung und je
 * zurueckgestellter Meldung eine, mit dem Schluessel des Befunds. `sent`
 * sagt, ob die Meldung an Telegram geht (false: kein Chat gekoppelt).
 */
export function watchLogLines(step: WatchStep, sent: boolean): string[] {
  const note = sent ? "" : " (kein Telegram-Chat gekoppelt, steht im KI-Protokoll)";
  return [
    ...step.announce.map((f) => `Zustands-Wächter: gemeldet [${f.key}] ${f.title}${note}`),
    ...step.resolved.map((f) => `Zustands-Wächter: Entwarnung [${f.key}] ${f.title} (nach ${minutes(f.sinceMs)} min)${note}`),
    ...step.deferredNow.map((f) => `Zustands-Wächter: Ruhezeit, Meldung kommt am Morgen [${f.key}] ${f.title}`),
  ];
}

/**
 * Titel des Befunds zu einer Kamera, die nicht antwortet. Beginnt der Name
 * schon mit „Kamera“, steht das Wort nur einmal da.
 */
export function cameraUnreachableTitle(name: string): string {
  const n = name.trim();
  if (!n) return "Kamera nicht erreichbar";
  return `${/^kamera(?![a-zäöüß])/i.test(n) ? n : `Kamera ${n}`} nicht erreichbar`;
}

/** Minuten nach dem Start des Hubs, ab denen ein Face-Sidecar, der nicht bereit ist, neu gemeldet wird. */
export const FACE_GRACE_MIN = 15;

/**
 * Gilt der Befund „Gesichtserkennung nicht bereit“? Der Sidecar braucht nach
 * dem Start laenger als der Hub: Neu gemeldet wird erst nach FACE_GRACE_MIN.
 * Ein schon gemeldeter Befund (`alreadyOpen`, auch aus dem Stand vor einem
 * Neustart) bleibt, bis der Sidecar bereit ist; so folgt auf einen Neustart
 * keine Entwarnung, der gleich dieselbe Meldung nachkommt.
 */
export function faceNotReadyDue(ready: boolean, uptimeMin: number, alreadyOpen: boolean): boolean {
  return !ready && (uptimeMin > FACE_GRACE_MIN || alreadyOpen);
}

/* ------------------------------------------------------------ Stand ueber Neustarts */

/** Aelter als das wird ein gespeicherter Stand verworfen. */
export const WATCH_STATE_MAX_AGE_MS = 24 * 60 * 60_000;

/** Stand fuer die Platte (.cache/agent-watch.json). `now` ist der Zeitpunkt des Speicherns. */
export function serializeWatch(st: WatchState, now: number): string {
  return JSON.stringify({
    v: 1,
    savedAt: now,
    tracked: [...st.tracked.values()],
    deferred: st.deferred,
    unsent: st.unsent,
  });
}

export interface WatchRestore {
  /** Der uebernommene Stand; ein leerer, wenn der gespeicherte verworfen wurde. */
  state: WatchState;
  /** Zeitpunkt, zu dem der uebernommene Stand gespeichert wurde. */
  savedAt: number | null;
  /** Warum der gespeicherte Stand verworfen wurde; null = uebernommen. */
  dropped: "unlesbar" | "veraltet" | null;
}

function reviveFinding(raw: unknown): Finding | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.key !== "string" || !r.key || typeof r.title !== "string" || !r.title) return null;
  if (r.severity !== "warn" && r.severity !== "alert") return null;
  const f: Finding = { key: r.key, severity: r.severity, title: r.title };
  if (typeof r.detail === "string" && r.detail) f.detail = r.detail;
  if (r.event === true) f.event = true;
  return f;
}

/**
 * Gespeicherten Stand lesen. Verworfen wird er, wenn er sich nicht lesen
 * laesst oder aelter als `maxAgeMs` ist: Dann beginnt der Waechter wie nach
 * dem ersten Start. Einzelne unvollstaendige Eintraege werden uebersprungen.
 * Kein Beginn liegt in der Zukunft.
 */
export function restoreWatch(json: string, now: number, maxAgeMs: number): WatchRestore {
  const drop = (dropped: "unlesbar" | "veraltet"): WatchRestore => ({ state: newWatchState(), savedAt: null, dropped });
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return drop("unlesbar");
  }
  if (typeof raw !== "object" || raw === null) return drop("unlesbar");
  const r = raw as { v?: unknown; savedAt?: unknown; tracked?: unknown; deferred?: unknown; unsent?: unknown };
  if (r.v !== 1 || typeof r.savedAt !== "number" || !Number.isFinite(r.savedAt) || !Array.isArray(r.tracked)) return drop("unlesbar");
  if (now - r.savedAt > maxAgeMs) {
    // Ein leerer Stand wird nie neu geschrieben (save() nur bei Aenderung) und
    // altert deshalb ohne Befund: Dann ging nichts verloren, kein Hinweis.
    const empty = r.tracked.length === 0 && !(Array.isArray(r.unsent) && r.unsent.length > 0);
    return empty ? { state: newWatchState(), savedAt: r.savedAt, dropped: null } : drop("veraltet");
  }

  const state = newWatchState();
  for (const item of r.tracked as unknown[]) {
    const t = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    const finding = reviveFinding(t.finding);
    if (!finding) continue;
    const seen = typeof t.seen === "number" && Number.isFinite(t.seen) && t.seen >= 1 ? Math.floor(t.seen) : 1;
    const since = typeof t.since === "number" && Number.isFinite(t.since) ? Math.min(t.since, now) : now;
    state.tracked.set(finding.key, { finding, seen, since, notified: t.notified === true });
  }
  // Zurueckgestellt ist nur, was als gemeldet gefuehrt wird (diffFindings); je Befund eine Meldung.
  for (const item of Array.isArray(r.deferred) ? (r.deferred as unknown[]) : []) {
    const f = reviveFinding(item);
    if (f && state.tracked.get(f.key)?.notified && !state.deferred.some((d) => d.key === f.key)) state.deferred.push(f);
  }
  for (const item of Array.isArray(r.unsent) ? (r.unsent as unknown[]) : []) {
    const f = reviveFinding(item);
    const sinceMs = (item as { sinceMs?: unknown } | null)?.sinceMs;
    if (!f || typeof sinceMs !== "number" || !Number.isFinite(sinceMs) || sinceMs < 0) continue;
    if (!state.unsent.some((u) => u.key === f.key)) state.unsent.push({ ...f, sinceMs });
  }
  if (state.unsent.length > UNSENT_MAX) state.unsent = state.unsent.slice(-UNSENT_MAX);
  return { state, savedAt: r.savedAt, dropped: null };
}
