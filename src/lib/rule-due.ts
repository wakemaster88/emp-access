/**
 * Faelligkeit zeitgesteuerter Raumregeln (Uhrzeit, Betriebsbeginn und -ende,
 * Sonnenauf- und -untergang) und der Regeln „Ruhe im Raum“ (`idleDue`).
 *
 * Rein, ohne Datenbank und ohne Netzwerk, damit sich jeder Zeitpunkt
 * nachrechnen laesst (Zeitumstellung, Mitternacht, verspaeteter Cron-Lauf).
 * Benutzt vom Cron-Lauf (`runRuleTick`) und vom Plan fuer den Hub
 * (`buildHubRulePlan`) in `room-rules.ts`.
 *
 * Ein Termin ist eine Soll-Zeit. Er ist faellig, solange
 * `Soll-Zeit <= jetzt < Soll-Zeit + Nachholfrist` gilt und fuer genau diesen
 * Termin noch kein erfolgreicher Lauf vorliegt. Faellt ein Cron-Lauf aus oder
 * scheitert das Schalten, versucht es der naechste Lauf erneut, aber nur mit
 * den Aktionen, die fuer diesen Termin noch nicht gelungen sind: Ein zweiter
 * Torimpuls oder eine zweite Nachricht waere schlimmer als keiner. Ist die
 * Frist ohne Erfolg vorbei, geht genau eine Meldung hinaus. Fehlt nur, was
 * der Hub im Notbetrieb selbst schaltet, und kann er es geschaltet haben,
 * wartet die Meldung (und das Sicherheitsnetz) bis zu einer Stunde auf
 * seinen Lauf (`missedDecision`).
 *
 * `RoomRule.lastOccurrenceAt` haelt die Soll-Zeit des zuletzt erfolgreich
 * gelaufenen Termins. Beim Anlegen einer Regel und bei Aenderungen an ihrem
 * Zeitplan steht dort der Zeitpunkt der Aenderung: Termine davor holt die
 * Regel nicht nach und meldet sie nicht. `lastRunAt` bleibt die Sperre gegen
 * gleichzeitige Laeufe.
 */

import { getSunTimesForAccount } from "./sun";
import { operatingBoundary, operatingOccurrenceForDay, type ScheduleSpec } from "./operating-hours";
import { addDaysToYmd, tzInstant, tzYmd } from "./tz-time";

/** So lange nach der Soll-Zeit darf ein Termin noch laufen. */
export const RULE_CATCH_UP_MS = 30 * 60_000;

/**
 * Betriebsbeginn: Die Nachholfrist endet spaetestens mit dem Betriebsende
 * desselben Betriebstags (ein Tor soll nach Betriebsschluss nicht mehr
 * auffahren), mindestens aber reicht sie bis zum ersten Cron-Lauf nach der
 * Soll-Zeit (Takt 5 Minuten plus Verzug).
 */
export const RULE_MIN_CATCH_UP_MS = 6 * 60_000;

/**
 * Bis zur Nachholfrist liefen Termine in einem Fenster von 3 Minuten vor bis
 * 3 Minuten nach der Soll-Zeit. Laeufe aus dieser Zeit zaehlen fuer den
 * Termin, auch wenn sie bis zu 3 Minuten vor der Soll-Zeit lagen; bis zu
 * dieser Grenze war ein Lauf auch fuer den Hub-Notbetrieb denkbar.
 */
export const RULE_LEGACY_WINDOW_MS = 3 * 60_000;

/** Sperre gegen gleichzeitige Laeufe derselben Regel (zwei Cron-Aufrufe). */
export const RULE_RUN_LOCK_MS = 3 * 60_000;

/**
 * Ein verpasster Termin wird nur gemeldet, solange seine Frist hoechstens so
 * lange vorbei ist: Kommt der Cron erst nach Stunden wieder, sind Meldungen zu
 * laengst vergangenen Terminen nur noch Laerm.
 */
export const MISSED_ALERT_LOOKBACK_MS = 2 * 3_600_000;

export type TimedTrigger = "TIME" | "OPENING" | "CLOSING" | "SUNRISE" | "SUNSET";

const TIMED = new Set<string>(["TIME", "OPENING", "CLOSING", "SUNRISE", "SUNSET"]);

export function isTimedTrigger(trigger: string): trigger is TimedTrigger {
  return TIMED.has(trigger);
}

/** Was die Rechnung von einer Regel braucht. */
export interface TimedRuleSpec {
  trigger: string;
  timeOfDay: string | null;
  offsetMinutes: number;
}

/** Umgebung der Regel: Zeitzone, Standort, zustaendige Betriebszeit. */
export interface OccurrenceEnv {
  timezone: string;
  latitude: number | null;
  longitude: number | null;
  schedule: ScheduleSpec | null;
}

export interface RuleOccurrence {
  /** Soll-Zeit, Versatz eingerechnet. */
  at: Date;
  /** Ende der Nachholfrist (ausschliesslich). */
  until: Date;
  /** Kalendertag bzw. Betriebstag "YYYY-MM-TT", zu dem der Termin gehoert. */
  ymd: string;
}

/**
 * Bezugszeitpunkt fuer die Sonnenzeiten eines Ortsdatums: Mittag UTC an
 * diesem Datum. sun.ts rechnet mit dem UTC-Tag; der Sonnentag mit Mittag
 * rund um 12 Uhr UTC minus Laengengrad/15 ist damit der Tag des Ortsdatums.
 */
function sunDayOf(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

/** Soll-Zeit der Regel an einem Kalendertag bzw. Betriebstag, oder null. */
function occurrenceAt(rule: TimedRuleSpec, env: OccurrenceEnv, ymd: string): Date | null {
  if (rule.trigger === "TIME") {
    return rule.timeOfDay ? tzInstant(ymd, rule.timeOfDay, env.timezone) : null;
  }
  if (rule.trigger === "OPENING" || rule.trigger === "CLOSING") {
    if (!env.schedule) return null;
    const occ = operatingOccurrenceForDay(
      env.schedule,
      { kind: rule.trigger === "OPENING" ? "open" : "close", offsetMinutes: rule.offsetMinutes, daysOfWeek: 127 },
      ymd,
      env.timezone,
    );
    return occ?.at ?? null;
  }
  if (rule.trigger === "SUNRISE" || rule.trigger === "SUNSET") {
    const sun = getSunTimesForAccount(env.latitude, env.longitude, sunDayOf(ymd));
    const base = rule.trigger === "SUNRISE" ? sun.sunrise : sun.sunset;
    return base ? new Date(base.getTime() + rule.offsetMinutes * 60_000) : null;
  }
  return null;
}

/** Ende der Nachholfrist eines Termins. */
export function catchUpUntil(rule: TimedRuleSpec, env: OccurrenceEnv, at: Date, ymd: string): Date {
  const full = at.getTime() + RULE_CATCH_UP_MS;
  if (rule.trigger !== "OPENING" || !env.schedule) return new Date(full);
  const close = operatingBoundary(env.schedule, ymd, "close", env.timezone);
  if (!close) return new Date(full);
  const floor = at.getTime() + RULE_MIN_CATCH_UP_MS;
  return new Date(Math.max(floor, Math.min(full, close.getTime())));
}

/**
 * Der Tag, von dem aus die Termine einer Regel gezaehlt werden: das
 * Ortsdatum in der Zeitzone des Betriebs, auch fuer Sonnenzeiten.
 */
function dayOf(env: OccurrenceEnv, at: Date): string {
  return tzYmd(at, env.timezone);
}

/** Termine der Tage `first` bis `last` (relativ zum Tag von `at`), nach Zeit sortiert. */
function occurrencesOverDays(
  rule: TimedRuleSpec,
  env: OccurrenceEnv,
  at: Date,
  first: number,
  last: number,
): RuleOccurrence[] {
  const base = dayOf(env, at);
  const out: RuleOccurrence[] = [];
  for (let d = first; d <= last; d++) {
    const ymd = addDaysToYmd(base, d);
    const when = occurrenceAt(rule, env, ymd);
    if (when) out.push({ at: when, ymd, until: catchUpUntil(rule, env, when, ymd) });
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/**
 * Termine rund um `now`, nach Zeit sortiert. Vortag und Folgetag gehoeren
 * dazu: Ein Betriebsende nach Mitternacht gehoert zum gestrigen Betriebstag,
 * ein Versatz vor Mitternacht kann auf den morgigen Beginn zeigen. Ebenso
 * bei Sonnenzeiten mit grossem Versatz (bis 12 Stunden): „5 Stunden nach
 * Sonnenuntergang“ liegt nach Mitternacht und gehoert zum Vortag.
 */
export function occurrencesAround(rule: TimedRuleSpec, env: OccurrenceEnv, now: Date): RuleOccurrence[] {
  return occurrencesOverDays(rule, env, now, -1, 1);
}

/** Termine mit Soll-Zeit in [from, to], nach Zeit sortiert (Plan fuer den Hub). */
export function occurrencesBetween(rule: TimedRuleSpec, env: OccurrenceEnv, from: Date, to: Date): RuleOccurrence[] {
  const days = Math.ceil((to.getTime() - from.getTime()) / 86_400_000) + 1;
  return occurrencesOverDays(rule, env, from, -1, days).filter(
    (o) => o.at.getTime() >= from.getTime() && o.at.getTime() <= to.getTime(),
  );
}

/**
 * Kernfrage: Ist dieser Termin jetzt faellig? Soll-Zeit erreicht, Frist noch
 * offen und fuer genau diesen (oder einen spaeteren) Termin noch kein
 * erfolgreicher Lauf. Ein spaeterer Termin zaehlt mit, damit eine Regel,
 * deren Uhrzeit nach einem Lauf vorverlegt wird, am selben Tag nicht noch
 * einmal laeuft.
 */
export function isOccurrenceDue(occ: RuleOccurrence, now: Date, lastOccurrenceAt: Date | null): boolean {
  const t = now.getTime();
  if (t < occ.at.getTime() || t >= occ.until.getTime()) return false;
  return !lastOccurrenceAt || lastOccurrenceAt.getTime() < occ.at.getTime();
}

/** Was die Regel ueber ihre Termine gespeichert hat. */
export interface OccurrenceMarks {
  /** Soll-Zeit des zuletzt erfolgreich gelaufenen Termins (bzw. Zeitpunkt der letzten Planaenderung). */
  lastOccurrenceAt: Date | null;
  /** Soll-Zeit des zuletzt als verpasst gemeldeten Termins. */
  lastMissedAt: Date | null;
  /** Angelegt am: Termine davor gab es fuer diese Regel nicht. */
  createdAt: Date | null;
}

export type DueStep =
  | { kind: "none" }
  /** Termin in der Frist, laut `lastOccurrenceAt` noch nicht gelaufen. */
  | { kind: "run"; occurrence: RuleOccurrence }
  /** Frist vorbei, nicht gelaufen und noch nicht gemeldet. */
  | { kind: "missed"; occurrence: RuleOccurrence };

/**
 * Naechster Schritt fuer eine Regel. `occurrences` sind die Termine, deren
 * Bedingungen (Wochentag, Zeitfenster, Betriebszeit, Dunkelheit) zur
 * Soll-Zeit erfuellt sind. Ob ein Termin laut Verlauf schon gelaufen ist,
 * prueft der Aufrufer danach mit `summarizeAttempts`.
 */
export function nextDueStep(occurrences: RuleOccurrence[], marks: OccurrenceMarks, now: Date): DueStep {
  const t = now.getTime();
  const past = occurrences.filter((o) => o.at.getTime() <= t).sort((a, b) => b.at.getTime() - a.at.getTime());
  const due = past.find((o) => isOccurrenceDue(o, now, marks.lastOccurrenceAt));
  if (due) return { kind: "run", occurrence: due };
  const missed = past.find(
    (o) =>
      o.until.getTime() <= t &&
      t - o.until.getTime() < MISSED_ALERT_LOOKBACK_MS &&
      (!marks.lastOccurrenceAt || marks.lastOccurrenceAt.getTime() < o.at.getTime()) &&
      (!marks.lastMissedAt || marks.lastMissedAt.getTime() < o.at.getTime()) &&
      (!marks.createdAt || marks.createdAt.getTime() <= o.at.getTime()),
  );
  if (missed) return { kind: "missed", occurrence: missed };
  return { kind: "none" };
}

/** Felder, die bestimmen, wann eine Regel ihre Termine hat. */
export interface RuleScheduleFields {
  trigger: string;
  timeOfDay: string | null;
  offsetMinutes: number;
  daysOfWeek: number;
  roomId: number | null;
  operatingScheduleId: number | null;
  operatingExtent: string;
  operating: string;
  windowStart: string | null;
  windowEnd: string | null;
  onlyWhenDark: boolean;
  isActive: boolean;
}

const SCHEDULE_FIELDS: Array<keyof RuleScheduleFields> = [
  "trigger",
  "timeOfDay",
  "offsetMinutes",
  "daysOfWeek",
  "roomId",
  "operatingScheduleId",
  "operatingExtent",
  "operating",
  "windowStart",
  "windowEnd",
  "onlyWhenDark",
];

/**
 * Aendert das Speichern, wann die Regel laeuft? Dann steht in
 * `lastOccurrenceAt` der Zeitpunkt der Aenderung: Ein Termin, der nach der
 * neuen Einstellung schon vorbei ist, wird weder nachgeholt noch gemeldet,
 * und eine Regel, die heute schon lief, laeuft nach dem Vorverlegen ihrer
 * Uhrzeit nicht noch einmal. Einschalten zaehlt mit, Ausschalten nicht.
 */
export function scheduleChanged(before: RuleScheduleFields, after: RuleScheduleFields): boolean {
  if (!before.isActive && after.isActive) return true;
  return SCHEDULE_FIELDS.some((f) => (before[f] ?? null) !== (after[f] ?? null));
}

// ─── Aktionen eines Termins ───────────────────────────────────────────────────

/** Was eine Aktion ausmacht, unabhaengig von ihrer Datenbank-ID. */
export interface ActionShape {
  id: number;
  kind: string;
  deviceId?: number | null;
  deviceAction?: string | null;
  channel?: string | null;
  audioZoneId?: number | null;
  audioAnnouncementId?: number | null;
  audioPlaylistId?: number | null;
  targetCameraId?: number | null;
  ptzPresetId?: number | null;
  autoTrack?: boolean | null;
}

function baseKey(a: ActionShape): string {
  switch (a.kind) {
    case "DEVICE":
      return `DEVICE:${a.deviceId ?? "-"}:${a.deviceAction ?? "-"}`;
    case "NOTIFY":
      return `NOTIFY:${a.channel ?? "PUSH"}`;
    case "AUDIO":
      return `AUDIO:${a.audioZoneId ?? "-"}:${a.audioAnnouncementId ?? "-"}:${a.audioPlaylistId ?? "-"}`;
    case "CAMERA":
      return `CAMERA:${a.targetCameraId ?? "-"}:${a.ptzPresetId ?? "-"}:${a.autoTrack ?? "-"}`;
    default:
      return `${a.kind}:${a.id}`;
  }
}

/**
 * Schluessel je Aktion, der ein Speichern der Regel uebersteht: Beim
 * Speichern entstehen die Aktionen neu und bekommen neue IDs. Gleiche
 * Aktionen in einer Regel werden durchgezaehlt.
 */
export function actionKeys(actions: ActionShape[]): Map<number, string> {
  const seen = new Map<string, number>();
  const out = new Map<number, string>();
  for (const a of actions) {
    const base = baseKey(a);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.set(a.id, n === 0 ? base : `${base}#${n + 1}`);
  }
  return out;
}

/**
 * Geraet und Befehl aus einem Schluessel `DEVICE:<id>:<befehl>[#n]`
 * (`actionKeys`); null bei anderen Aktionen oder ohne Geraet.
 */
export function deviceOfKey(key: unknown): { deviceId: number; deviceAction: string } | null {
  if (typeof key !== "string") return null;
  const m = /^DEVICE:(\d+):([^:#]+)(?:#\d+)?$/.exec(key);
  if (!m || m[2] === "-") return null;
  const deviceId = Number(m[1]);
  return Number.isSafeInteger(deviceId) && deviceId > 0 ? { deviceId, deviceAction: m[2] } : null;
}

/** Ein Eintrag aus `RoomRuleRun.details`, so weit er hier gebraucht wird. */
export interface AttemptDetail {
  actionId?: number;
  key?: string;
  ok?: boolean;
  error?: string;
  /** An den Hub uebergeben (Auftragsnummer). */
  hubTaskId?: number;
  /** Hub-Auftrag noch ohne Ergebnis: Die Aktion ist in Arbeit, aber nicht gelungen. */
  pending?: boolean;
}

/** Ein Lauf der Regel aus dem Verlauf. */
export interface AttemptRow {
  triggerKind: string;
  triggeredAt: Date;
  success: boolean;
  details: unknown;
  errorMessage: string | null;
}

export interface AttemptSummary {
  /** Der Termin ist gelaufen: keine Aktion steht mehr aus. */
  done: boolean;
  /** Schluessel der Aktionen, die fuer diesen Termin schon gelungen sind. */
  okKeys: Set<string>;
  /**
   * Schluessel der Aktionen, deren Hub-Auftrag noch offen ist: in Arbeit,
   * kein zweiter Auftrag, aber auch nicht gelungen.
   */
  pendingKeys: Set<string>;
  /** Juengste Fehlermeldung, fuer die Meldung nach Fristende. */
  lastError: string | null;
  /** Zahl der Versuche zu diesem Termin. */
  attempts: number;
}

function detailsOf(row: AttemptRow): AttemptDetail[] {
  return Array.isArray(row.details) ? (row.details as AttemptDetail[]) : [];
}

/**
 * Wertet die Laeufe zu einem Termin aus. `rows` sind die Laeufe mit dem
 * eigenen Ausloeser (auch die vom Hub gemeldeten) ab Soll-Zeit minus
 * `RULE_LEGACY_WINDOW_MS`.
 *
 *  - Ein Lauf aus der Zeit vor der Nachholfrist (Cloud-Lauf ohne Schluessel
 *    in den Details) erledigt den Termin: Damals gab es genau einen
 *    Versuch, und der Termin gilt als gelaufen, auch wenn er scheiterte.
 *    So holt die Regel beim Ausrollen nichts nach, was vorher schon lief.
 *    Ebenso ein erfolgreicher Lauf des Hubs ohne Schluessel.
 *  - Sonst zaehlt je Aktion, und erledigt ist der Termin erst, wenn jede
 *    Aktion gelang. Ein Nachhol-Versuch enthaelt nur die fehlenden Aktionen;
 *    sein Erfolg allein erledigt den Termin deshalb nicht.
 *  - An den Hub uebergeben (Hue, Kamera steuern) ist in Arbeit, solange der
 *    Auftrag offen ist (`pendingKeys`), und gelungen erst mit seinem
 *    Ergebnis. Scheitert oder verfaellt er, fehlt die Aktion wieder.
 */
export function summarizeAttempts(actions: ActionShape[], rows: AttemptRow[]): AttemptSummary {
  const keys = actionKeys(actions);
  const okKeys = new Set<string>();
  const pendingKeys = new Set<string>();
  let done = false;
  let lastError: string | null = null;
  let lastErrorAt = -Infinity;
  for (const row of rows) {
    const details = detailsOf(row);
    const fromHub = row.triggerKind.startsWith("hub:");
    if (!details.some((d) => typeof d.key === "string") && (!fromHub || row.success)) done = true;
    for (const d of details) {
      const key = typeof d.key === "string" ? d.key : d.actionId != null ? keys.get(d.actionId) : undefined;
      if (!key) continue;
      if (d.ok === true) okKeys.add(key);
      else if (d.pending === true && d.hubTaskId != null) pendingKeys.add(key);
    }
    if (!row.success && row.errorMessage && row.triggeredAt.getTime() > lastErrorAt) {
      lastError = row.errorMessage;
      lastErrorAt = row.triggeredAt.getTime();
    }
  }
  for (const k of okKeys) pendingKeys.delete(k);
  if (!done && actions.length > 0 && [...keys.values()].every((k) => okKeys.has(k))) done = true;
  return { done, okKeys, pendingKeys, lastError, attempts: rows.length };
}

// ─── Sicherheitsnetz zum Betriebsende ─────────────────────────────────────────

/**
 * Zugehoerig sind eine Regel „Betriebsbeginn“ und eine Regel „Betriebsende“,
 * wenn die erste ein Geraet oeffnet (`open`), das die zweite schliesst
 * (`close`). Der Raum entscheidet nicht: Zwei Regeln im selben Raum koennen
 * verschiedene Tore bedienen, und dasselbe Tor kann an einer Regel ohne Raum
 * haengen. Ergebnis: die Geraete, die das Netz schliessen darf.
 */
export function pairedCloseDevices(
  closing: Array<{ kind: string; deviceId?: number | null; deviceAction?: string | null }>,
  openings: Array<Array<{ kind: string; deviceId?: number | null; deviceAction?: string | null }>>,
): Set<number> {
  const opened = new Set<number>();
  for (const actions of openings) {
    for (const a of actions) if (a.kind === "DEVICE" && a.deviceAction === "open" && a.deviceId) opened.add(a.deviceId);
  }
  const out = new Set<number>();
  for (const a of closing) {
    if (a.kind === "DEVICE" && a.deviceAction === "close" && a.deviceId && opened.has(a.deviceId)) out.add(a.deviceId);
  }
  return out;
}

/**
 * Hat ein Lauf die Geraete in `deviceIds` mit dem Befehl `wanted` geschaltet?
 * "ok": jede passende Aktion gelang (mindestens eine), "partial": manche
 * gelangen, manche nicht, "failed": keine gelang, "none": keine passende
 * Aktion im Lauf. Laeufe des Hubs und aeltere Laeufe der Cloud tragen kein
 * Geraet in den Details; dann hilft die Aktion der Regel, nach einem
 * Speichern der Regel (neue Aktions-IDs) der Schluessel der Aktion.
 */
export function rowTouchesDevices(
  row: AttemptRow,
  actionDevices: Map<number, { deviceId: number | null; deviceAction: string | null }>,
  deviceIds: Set<number>,
  wanted: string,
): "ok" | "partial" | "failed" | "none" {
  let ok = 0;
  let failed = 0;
  for (const d of detailsOf(row) as Array<AttemptDetail & { deviceId?: number; deviceAction?: string; kind?: string }>) {
    const fallback = (d.actionId != null ? actionDevices.get(d.actionId) : undefined) ?? deviceOfKey(d.key);
    const deviceId = d.deviceId ?? fallback?.deviceId ?? null;
    const action = d.deviceAction ?? fallback?.deviceAction ?? null;
    if (deviceId == null || !deviceIds.has(deviceId) || action !== wanted) continue;
    if (d.ok === true) ok++;
    else failed++;
  }
  if (ok === 0) return failed > 0 ? "failed" : "none";
  return failed > 0 ? "partial" : "ok";
}

/** Ab so viel Ruhe nach dem Betrieb greift das Netz. */
export const CLOSING_NET_AFTER_MS = 30 * 60_000;

export interface ClosingNetInput {
  /** Juengster Lauf einer zugehoerigen Regel „Betriebsbeginn“, der mindestens eines der Geraete geoeffnet hat. */
  lastOpenedAt: Date | null;
  /** Juengster Lauf dieser Regel, der alle diese Geraete geschlossen hat (auch das Netz selbst, auch von Hand). */
  lastClosedAt: Date | null;
  /** Juengster Versuch des Netzes; es schliesst je Oeffnung hoechstens einmal. */
  lastNetAt: Date | null;
  /**
   * Betrieb laut Betriebszeit der Regel oder einer zugehoerigen Regel
   * „Betriebsbeginn“, die seitdem geoeffnet hat (je mit ihrer Reichweite), in
   * den letzten 30 Minuten oder demnaechst (so weit die Oeffnung vorauslaeuft).
   */
  operatingNearby: boolean;
  /** Eigener Termin dieser Regel nach der Oeffnung, dessen Frist noch laeuft oder der bald kommt. */
  ownPending: boolean;
}

/** So weit zurueck sucht das Netz nach der letzten Oeffnung. */
export const CLOSING_NET_LOOKBACK_MS = 7 * 86_400_000;

/**
 * Ab wann eine Oeffnung fuer das Netz einer Regel „Betriebsende“ zaehlt:
 * nicht vor ihrem Anlegen und hoechstens `CLOSING_NET_LOOKBACK_MS` zurueck.
 * Sonst schloesse eine neu angelegte Regel ein Tor, das eine Oeffnung von vor
 * Tagen aufgemacht hat und das seitdem jemand anders bedient.
 *
 * Der Vermerk der Regel (`lastOccurrenceAt`) zaehlt nicht: Eine Aenderung am
 * Zeitplan oder das Wieder-Einschalten setzt ihn neu, auch nach der Oeffnung
 * des Tages, und scheiterte danach der Termin, bliebe das Tor offen. Ob seit
 * der Oeffnung geschlossen wurde, sieht das Netz an den Laeufen der Regel
 * (`ClosingNetInput.lastClosedAt`).
 */
export function closingNetSince(rule: { createdAt: Date }, now: Date): Date {
  return new Date(Math.max(now.getTime() - CLOSING_NET_LOOKBACK_MS, rule.createdAt.getTime()));
}

/**
 * Sicherheitsnetz fuer Regeln „Betriebsende“: Folgte auf die letzte Oeffnung
 * kein Schliessen, ist seit mindestens 30 Minuten kein Betrieb und steht
 * kein eigener Termin der Regel mehr aus, schliesst das Netz einmal. Das
 * deckt stornierte und verschobene Buchungen ab (der Termin zum
 * Betriebsende verschwindet dann) und einen Termin, dessen Frist ohne
 * Erfolg ablief. Es fuehrt nur Schliess-Aktionen aus und oeffnet nie.
 */
export function closingNetDue(input: ClosingNetInput, now: Date): boolean {
  const opened = input.lastOpenedAt?.getTime();
  if (opened == null) return false;
  if (input.lastClosedAt && input.lastClosedAt.getTime() >= opened) return false;
  if (input.lastNetAt && input.lastNetAt.getTime() >= opened) return false;
  if (now.getTime() - opened < CLOSING_NET_AFTER_MS) return false;
  return !input.operatingNearby && !input.ownPending;
}

// ─── Hub ──────────────────────────────────────────────────────────────────────

/** Termin, den der Hub im Notbetrieb ausgefuehrt und der Cloud noch nicht gemeldet hat. */
export interface HubAnnouncedFire {
  ruleId: number;
  /** Termin laut Plan des Hubs (ms, auf die Minute gerundet). */
  fireAt: number;
}

/** Angabe `rules` aus dem juengsten Lebenszeichen des Hubs. */
export interface HubRulesReport {
  mode: string;
  pending: number;
  /** Zeit des Lebenszeichens, mit dem die Angabe kam. */
  at: Date | null;
  /** Ausgefuehrte, noch nicht gemeldete Termine (hub/src/outage-rules.ts, `announcedFires`). */
  fires: HubAnnouncedFire[];
  /** Der Hub faehrt Rolltore im Notbetrieb selbst zu (HUB_EMERGENCY_COVER_CLOSE). */
  coverClose: boolean;
  /** Ende seines Plans fuer den Notbetrieb; null: Der Hub hat keinen. */
  planUntil: Date | null;
}

/** Was die Cloud vom Hub weiss (HubAgent, Lebenszeichen). */
export interface HubRuleState {
  lastSeenAt: Date | null;
  /** Fehlt bei aelteren Hubs. */
  rules: HubRulesReport | null;
}

/** So viele angekuendigte Termine nimmt die Cloud aus einem Lebenszeichen. */
export const HUB_FIRES_MAX = 100;

/** Angabe `rules`, wie sie in HubAgent.status landet. */
export interface StoredHubRulesReport {
  mode: "hub" | "cloud";
  pending: number;
  at: string;
  fires: Array<{ ruleId: number; fireAt: string }>;
  coverClose: boolean;
  planUntil: string | null;
}

function isoOrNull(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * Angabe `rules` aus dem Lebenszeichen des Hubs, wie sie in HubAgent.status
 * landet; null, wenn sie fehlt oder nicht passt. `fires`, `coverClose` und
 * `planUntil` fehlen bei frueheren Hub-Staenden und gelten dann als leer.
 */
export function parseHubRulesReport(raw: unknown, now: Date): StoredHubRulesReport | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { mode, pending, fires, coverClose, planUntil } = raw as {
    mode?: unknown;
    pending?: unknown;
    fires?: unknown;
    coverClose?: unknown;
    planUntil?: unknown;
  };
  if (mode !== "hub" && mode !== "cloud") return null;
  if (typeof pending !== "number" || !Number.isInteger(pending) || pending < 0) return null;
  const announced: Array<{ ruleId: number; fireAt: string }> = [];
  for (const f of Array.isArray(fires) ? fires : []) {
    if (announced.length >= HUB_FIRES_MAX) break;
    const ruleId = (f as { ruleId?: unknown } | null)?.ruleId;
    const fireAt = isoOrNull((f as { fireAt?: unknown } | null)?.fireAt);
    if (typeof ruleId === "number" && Number.isInteger(ruleId) && ruleId > 0 && fireAt) announced.push({ ruleId, fireAt });
  }
  return {
    mode,
    pending: Math.min(pending, 100_000),
    at: now.toISOString(),
    fires: announced,
    coverClose: coverClose === true,
    planUntil: isoOrNull(planUntil),
  };
}

/** Gespeicherte Angabe aus HubAgent.status lesen; null, wenn sie fehlt oder nicht passt. */
export function readHubRulesReport(raw: unknown): HubRulesReport | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as { mode?: unknown; pending?: unknown; at?: unknown; fires?: unknown; coverClose?: unknown; planUntil?: unknown };
  if (typeof r.mode !== "string" || typeof r.pending !== "number") return null;
  const at = isoOrNull(r.at);
  const planUntil = isoOrNull(r.planUntil);
  const fires: HubAnnouncedFire[] = [];
  for (const f of Array.isArray(r.fires) ? r.fires : []) {
    const ruleId = (f as { ruleId?: unknown } | null)?.ruleId;
    const fireAt = isoOrNull((f as { fireAt?: unknown } | null)?.fireAt);
    if (typeof ruleId === "number" && fireAt) fires.push({ ruleId, fireAt: Date.parse(fireAt) });
  }
  return {
    mode: r.mode,
    pending: r.pending,
    at: at ? new Date(at) : null,
    fires,
    coverClose: r.coverClose === true,
    planUntil: planUntil ? new Date(planUntil) : null,
  };
}

/**
 * Gehoert ein Termin laut Plan des Hubs (`fireAt`, auf die Minute gerundet)
 * zu diesem Termin der Cloud? Der Plan rundet bis zu 30 Sekunden vor die
 * Soll-Zeit, und der Hub fuehrt einen Termin bis zum Ende der Nachholfrist
 * aus; Laeufe bis `RULE_LEGACY_WINDOW_MS` vor der Soll-Zeit zaehlen mit.
 */
export function hubFireMatches(occ: RuleOccurrence, fireAt: number): boolean {
  return fireAt >= occ.at.getTime() - RULE_LEGACY_WINDOW_MS && fireAt < occ.until.getTime();
}

/** Schon ein vom Hub gemeldeter Lauf zu diesem Termin im Verlauf? */
function hasHubRow(rows: AttemptRow[]): boolean {
  return rows.some((r) => r.triggerKind.startsWith("hub:"));
}

/**
 * Hat der Hub diesen Termin im Notbetrieb ausgefuehrt und der Cloud noch
 * nicht gemeldet? Das sagt sein juengstes Lebenszeichen (`fires`), solange
 * sein Lauf nicht im Verlauf steht (`rows`: Laeufe zu diesem Termin). Dann
 * holt die Cloud nichts nach, was der Hub selbst schaltet, sondern wartet auf
 * seinen Lauf: Er meldet ihn gleich nach der Rueckkehr der Verbindung.
 *
 * Schweigt der Hub nur, holt die Cloud wie ohne Hub nach: Ist das Netz am
 * Standort weg, erreicht auch sie die Geraete nicht, und ein Versuch
 * scheitert ohne Folgen; ist der Hub aus, schaltet sonst niemand.
 */
export function hubRunAnnounced(
  hub: HubRuleState | null,
  ruleId: number,
  occ: RuleOccurrence,
  rows: AttemptRow[],
): boolean {
  const fires = hub?.rules?.fires ?? [];
  if (!fires.some((f) => f.ruleId === ruleId && hubFireMatches(occ, f.fireAt))) return false;
  return !hasHubRow(rows);
}

/**
 * Spielraum fuer „der Hub hatte nach dem Termin Kontakt“: Der Hub fuehrt im
 * Notbetrieb Termine nach seinem letzten Kontakt aus. Nach einem Absturz
 * kennt er diesen Kontakt aus hub/.cache, der bis zu einem Takt (20 s) zurueck
 * liegen kann.
 */
export const HUB_CONTACT_MARGIN_MS = 60_000;

/**
 * Termine bis so lange vor seinem letzten Kontakt holt der Hub im
 * Notbetrieb ebenfalls nach, aber nur Aus und Zu (hub/src/outage-rules.ts,
 * `OUTAGE_CONTACT_GAP_MS`): Die Cloud schaltet einen Termin erst mit ihrem
 * naechsten Cron-Lauf, und faellt das Netz am Standort dazwischen aus,
 * erreicht sie die Geraete nicht mehr.
 */
export const HUB_CONTACT_GAP_MS = 6 * 60_000;

/**
 * Was der Hub zu einem Termin im Notbetrieb geschaltet haben kann: „all“
 * alles, was er selbst schaltet (`hubRunsLocally`, `isHubLocalKind`),
 * „safe“ davon nur Aus und Zu (`hubRunsLocally` mit `safeOnly`).
 */
export type HubRunScope = "all" | "safe";

/**
 * Kann der Hub diesen Termin im Notbetrieb geschaltet haben, ohne dass die
 * Cloud davon weiss, und was davon? Sein Plan muss den Termin enthalten, und
 * sein Lauf darf noch nicht im Verlauf stehen. Dann:
 *
 *  - „all“, wenn er ihn angekuendigt hat (`hubRunAnnounced`) oder sein
 *    letztes Lebenszeichen vor dem Termin lag: Er ist seither aus oder im
 *    Notbetrieb und meldet sich mit seinem Lauf, sobald die Verbindung
 *    zurueck ist.
 *  - „safe“, wenn sein letztes Lebenszeichen bis `HUB_CONTACT_GAP_MS` nach
 *    dem Termin lag: Den holt er im Notbetrieb nur mit Aus und Zu nach.
 *  - null, wenn danach noch ein Lebenszeichen ohne Ankuendigung kam (dann
 *    hat er ihn nicht ausgefuehrt), und bei einem Hub ohne Angabe (aeltere
 *    Fassung).
 */
export function hubRunScope(
  hub: HubRuleState | null,
  ruleId: number,
  occ: RuleOccurrence,
  rows: AttemptRow[],
): HubRunScope | null {
  const rules = hub?.rules;
  if (!rules?.at || hasHubRow(rows)) return null;
  if (hubRunAnnounced(hub, ruleId, occ, rows)) return "all";
  const fireAt = Math.round(occ.at.getTime() / 60_000) * 60_000;
  if (!rules.planUntil || rules.planUntil.getTime() < fireAt) return null;
  const seen = rules.at.getTime();
  if (seen < fireAt + HUB_CONTACT_MARGIN_MS) return "all";
  if (seen < fireAt + HUB_CONTACT_GAP_MS + HUB_CONTACT_MARGIN_MS) return "safe";
  return null;
}

/** Kann der Hub diesen Termin im Notbetrieb geschaltet haben (`hubRunScope`, ganz oder nur Aus und Zu)? */
export function hubMayHaveRun(
  hub: HubRuleState | null,
  ruleId: number,
  occ: RuleOccurrence,
  rows: AttemptRow[],
): boolean {
  return hubRunScope(hub, ruleId, occ, rows) !== null;
}

/**
 * So lange nach dem Ende der Nachholfrist wartet die Meldung „nicht
 * ausgefuehrt“ (und das Sicherheitsnetz) hoechstens auf den Lauf des Hubs.
 * Danach geht die Meldung mit dem Hinweis hinaus, dass das Ergebnis des
 * Hubs aussteht; sie liegt damit noch in `MISSED_ALERT_LOOKBACK_MS`.
 */
export const MISSED_HUB_WAIT_MS = 60 * 60_000;

/**
 * Frist vorbei, Termin nicht erledigt: melden oder auf den Hub warten?
 * Warten nur, wenn alles, was fehlt, Aktionen sind, die der Hub im
 * Notbetrieb selbst schaltet (`hubKeys`), und er sie geschaltet haben kann
 * (`hubMayHaveRun`): Sonst ginge eine falsche Meldung „nicht ausgefuehrt“
 * hinaus. Hoechstens bis `MISSED_HUB_WAIT_MS` nach Fristende; dann
 * „unbestaetigt“. Fehlt etwas, das nur die Cloud schaltet, wird sofort
 * gemeldet.
 */
export function missedDecision(
  input: { missingKeys: string[]; hubKeys: Set<string>; hubMayHaveRun: boolean; until: Date },
  now: Date,
): "report" | "wait" | "report-unconfirmed" {
  const onlyHub = input.missingKeys.length > 0 && input.missingKeys.every((k) => input.hubKeys.has(k));
  if (!onlyHub || !input.hubMayHaveRun) return "report";
  return now.getTime() < input.until.getTime() + MISSED_HUB_WAIT_MS ? "wait" : "report-unconfirmed";
}

/**
 * Juengster eigener Termin nach `after` (der letzten Oeffnung), der schon
 * erreicht ist: auf ihn wartet das Sicherheitsnetz, falls der Hub ihn im
 * Notbetrieb geschlossen haben kann. null: kein Termin seither (etwa eine
 * stornierte Buchung), dann hatte auch der Hub nichts zu schliessen.
 */
export function lastOccurrenceAfter(occurrences: RuleOccurrence[], after: Date, now: Date): RuleOccurrence | null {
  let out: RuleOccurrence | null = null;
  for (const o of occurrences) {
    if (o.at.getTime() <= after.getTime() || o.at.getTime() > now.getTime()) continue;
    if (!out || o.at.getTime() > out.at.getTime()) out = o;
  }
  return out;
}

const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
/** Shellys, die der Hub im Notbetrieb schaltet: Licht und Schalter. */
const HUB_LATCHING_CATEGORIES = new Set(["SCHALTER", "BELEUCHTUNG"]);
/** Ein (open, emergency) und Aus (deactivate, reset) an Licht, Schalter und Hue. */
const HUB_SWITCH_ACTIONS = new Set(["open", "emergency", "deactivate", "reset"]);
/** Davon Aus: Das schaltet der Hub auch zu einem Termin kurz vor seinem letzten Kontakt. */
const HUB_OFF_ACTIONS = new Set(["deactivate", "reset"]);

/**
 * Schaltet der Hub diese Geraete-Aktion einer Zeit-Regel im Notbetrieb
 * selbst? Spiegelt die Erlaubnisliste in hub/src/outage-rules.ts
 * (`outageActionStep`): Ein und Aus an Hue ueber die Bridge und an Shellys
 * der Kategorie Schalter oder Beleuchtung mit IP, dazu „zu“ an einem Rolltor
 * mit IP, wenn der Hub das Zufahren laut Lebenszeichen an hat (`coverClose`,
 * HUB_EMERGENCY_COVER_CLOSE). Tueroeffner, Drehkreuze, Taster und Shellys
 * ohne Kategorie schaltet er nie. `safeOnly`: Termin kurz vor seinem letzten
 * Kontakt (`hubRunScope` „safe“), davon nur Aus und Zu. Kamera-Aktionen
 * fuehrt der Hub im Notbetrieb sonst immer selbst aus (siehe `isHubLocalKind`).
 */
export function hubRunsLocally(
  device: { type: string; category?: string | null; ipAddress?: string | null; hueBridgeId?: string | null; hueLightId?: string | null },
  action: string,
  coverClose = false,
  safeOnly = false,
): boolean {
  const actions = safeOnly ? HUB_OFF_ACTIONS : HUB_SWITCH_ACTIONS;
  if (device.type === "HUE_LIGHT") return !!device.hueBridgeId && !!device.hueLightId && actions.has(action);
  if (device.type !== "SHELLY") return false;
  if (!device.ipAddress || !IPV4_RE.test(device.ipAddress)) return false;
  if (device.category === "ROLLTOR") return coverClose && action === "close";
  return HUB_LATCHING_CATEGORIES.has(device.category ?? "") && actions.has(action);
}

/**
 * Aktionsarten, die der Hub im Notbetrieb ohne Geraeteabfrage selbst
 * ausfuehrt; zu einem Termin kurz vor seinem letzten Kontakt (`safeOnly`)
 * keine.
 */
export function isHubLocalKind(kind: string, safeOnly = false): boolean {
  return kind === "CAMERA" && !safeOnly;
}

// ─── Ruhe im Raum ─────────────────────────────────────────────────────────────

/**
 * Was bei „Ruhe im Raum“ als Bewegung zaehlt. Ohne Angabe Person und
 * Fahrzeug: Reine Pixel-Bewegung (Wasser, Regen, Baeume) meldet eine
 * Aussenkamera so oft, dass sonst nie Ruhe erkannt wuerde. „Bewegung“ an der
 * Regel nimmt sie ausdruecklich dazu.
 */
export function idleActivityTypes(eventType: string | null | undefined): string[] {
  if (eventType === "MOTION") return ["PERSON", "VEHICLE", "MOTION"];
  if (eventType === "PERSON") return ["PERSON"];
  if (eventType === "VEHICLE") return ["VEHICLE"];
  return ["PERSON", "VEHICLE"];
}

/**
 * Ist eine Regel „Ruhe im Raum“ jetzt faellig? Nur mit Kamera im Raum (ohne
 * sie gaelte der Raum immer als ruhig), wenn die letzte Aktivitaet mindestens
 * `idleMinutes` zurueckliegt und seit dieser Aktivitaet noch kein Lauf war:
 * einmal je Ruhephase, wie im Notbetrieb des Hubs. `lastActivity` null heisst:
 * seit dem letzten Lauf (bzw. im betrachteten Zeitraum) keine Aktivitaet.
 */
export function idleDue(
  idleMinutes: number | null | undefined,
  lastActivity: Date | null,
  lastRunAt: Date | null,
  hasSensors: boolean,
  now: Date,
): boolean {
  if (!hasSensors || !idleMinutes || idleMinutes <= 0) return false;
  if (lastActivity && now.getTime() - lastActivity.getTime() < idleMinutes * 60_000) return false;
  if (lastRunAt && (!lastActivity || lastRunAt.getTime() >= lastActivity.getTime())) return false;
  return true;
}
