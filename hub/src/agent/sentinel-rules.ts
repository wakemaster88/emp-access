/**
 * Wann schaut sich der Assistent ein Kamera-Ereignis selbst an? Reine Logik.
 *
 * Auffaellig kann nur sein, was ausserhalb des Betriebs passiert: Person oder
 * Fahrzeug an einer Kamera, deren Raum gerade geschlossen ist, bzw. (Kamera
 * ohne Raum mit Betriebszeit) im Nachtfenster. Waehrend des Betriebs laufen
 * hunderte Personen-Ereignisse am Tag – die bewertet er nicht.
 */
import { inQuietHours } from "./quiet.js";

export interface SentinelEvent {
  kind: string;
  title: string;
  where: string | null;
}

export interface SentinelContext {
  /** true = Raum der Kamera geschlossen, false = offen, null = keine Betriebszeit bekannt. */
  closed: boolean | null;
  hour: number;
  nightWindow: string;
  /** Alle Personen/Fahrzeuge bewerten, auch im Betrieb (HUB_AGENT_SENTINEL=always). */
  always: boolean;
  /** Beginn der letzten Bewertung dieser Kamera. */
  lastInspectAt: number | undefined;
  now: number;
  /** Sperrzeit dieser Kamera ab dem Beginn der letzten Bewertung (cooldownFor, lockMs). */
  cooldownMs: number;
  /** Bewertungen der letzten Stunde (alle Kameras), ohne die vorgezogenen. */
  inspectionsLastHour: number;
  maxPerHour: number;
}

export function isTriggerEvent(ev: SentinelEvent): boolean {
  if (!ev.where) return false;
  if (ev.kind === "camera") return /^(PERSON|VEHICLE)\b.*erkannt$/.test(ev.title);
  return false;
}

/** Warum ein Ausloeser nicht bewertet wird. */
export type SkipReason =
  /** Die Sperrzeit der Kamera laeuft noch. */
  | "abstand"
  /** Das Stundenlimit ueber alle Kameras ist erreicht (vorgezogene Bewertungen zaehlen dafuer nicht). */
  | "limit"
  /** Kein Platz fuer die Bewertung frei: verfallen, oder fuer die Kamera wartete schon ein Ausloeser. */
  | "belegt";

/**
 * Wird die Kamera gerade bewacht? Ja bei „always“, bei geschlossenem Raum und,
 * ohne bekannte Betriebszeit (closed null), im Nachtfenster. Dieselbe Regel
 * gilt fuer die Ausloeser (triggerVerdict) und fuer die Liste der bewachten
 * Kameras, die der Hub der Cloud meldet (sentinel-cover-rules.ts).
 */
export function cameraWatched(ctx: Pick<SentinelContext, "always" | "closed" | "hour" | "nightWindow">): boolean {
  return ctx.always || ctx.closed === true || (ctx.closed !== false && inQuietHours(ctx.nightWindow, ctx.hour));
}

/**
 * Ein Kamera-Ereignis einordnen. Ausloeser ist der Beginn eines Personen-
 * oder Fahrzeugereignisses an einer Kamera, die gerade bewacht wird
 * (cameraWatched). Ein Ausloeser wird bewertet oder wegen Abstand bzw.
 * Stundenlimit uebergangen.
 */
export function triggerVerdict(ev: SentinelEvent, ctx: SentinelContext): "bewerten" | "kein_ausloeser" | "abstand" | "limit" {
  if (!isTriggerEvent(ev)) return "kein_ausloeser";
  if (!cameraWatched(ctx)) return "kein_ausloeser";
  if (ctx.lastInspectAt !== undefined && ctx.now - ctx.lastInspectAt < ctx.cooldownMs) return "abstand";
  if (ctx.inspectionsLastHour >= ctx.maxPerHour) return "limit";
  return "bewerten";
}

export function shouldInspect(ev: SentinelEvent, ctx: SentinelContext): boolean {
  return triggerVerdict(ev, ctx) === "bewerten";
}

/* ------------------------------------------------ Sperrzeit je Kamera */

/** Ergebnis einer Bewertung, wie Sperrzeit und Bilanz es brauchen. */
export type InspectOutcome =
  /** Ein Alarm ging hinaus. */
  | "alarm"
  /** Bekannte Person, vermutlich Mitarbeiter oder genehmigtes Fahrzeug. */
  | "kein_alarm"
  /** Das Bildmodell sieht nichts Auffaelliges. */
  | "unauffaellig"
  /** Der Tracker findet auf zwei Bildern keine Person. */
  | "tracker_leer"
  /** Auf der Nahaufnahme ist keine Person. */
  | "nahaufnahme_leer"
  /** Bild oder Bewertung fehlgeschlagen. */
  | "fehler";

/** Mindestabstand je Kamera; gilt auch, solange eine Bewertung noch laeuft. */
export const COOLDOWN_MS = 3 * 60_000;
/** Mindestabstand im Nachtfenster, wenn die Bewertung nichts ergeben hat. */
export const EMPTY_COOLDOWN_MS = 45_000;

/**
 * Sperrzeit der Kamera nach einer Bewertung, gerechnet ab deren Beginn.
 * Nach einem Alarm oder „kein Alarm“ (bekannte Person, genehmigtes Fahrzeug)
 * ist die Lage geklaert: 3 Minuten. Hat die Bewertung nichts ergeben
 * (unauffaellig, niemand im Bild, Fehler), kann die Person noch nicht oder
 * nicht mehr im Bild gewesen sein: Im Nachtfenster sieht der Waechter
 * deshalb schon nach 45 Sekunden wieder hin. Am Tag bleibt es bei 3 Minuten.
 */
export function cooldownFor(outcome: InspectOutcome, hour: number, nightWindow: string): number {
  if (outcome === "alarm" || outcome === "kein_alarm") return COOLDOWN_MS;
  return inQuietHours(nightWindow, hour) ? EMPTY_COOLDOWN_MS : COOLDOWN_MS;
}

/** So lange wird ein zurueckgestellter Ausloeser in jedem Takt erneut versucht. */
export const RETRY_MAX_AGE_MS = 30_000;

export interface RetryContext {
  /** Wann der Ausloeser zuerst gesehen wurde. */
  seenAt: number;
  now: number;
  /** Laufende Bewertungen (alle Kameras) und ihre Hoechstzahl. */
  busy: number;
  maxBusy: number;
  lastInspectAt: number | undefined;
  cooldownMs: number;
  /** Die Sperrzeit laeuft nur, weil das Ergebnis eines vorgezogenen Blicks auf diese Kamera aussteht (awaitsResult). */
  awaitsResult?: boolean;
  inspectionsLastHour: number;
  maxPerHour: number;
  /** Letzter Takt, in dem der Ausloeser auf einen Platz wartete, den ein vorgezogener Blick hielt (PendingTrigger.heldAt). */
  heldAt?: number;
}

/**
 * Ein zurueckgestellter Ausloeser: jetzt bewerten, weiter warten oder
 * aufgeben? Er wartet, solange kein Platz frei ist oder das Ergebnis eines
 * vorgezogenen Blicks auf seine Kamera aussteht. Wurde seine Kamera inzwischen
 * bewertet, gilt deren Sperrzeit (kein Ausloeser wird doppelt bewertet). Wer
 * RETRY_MAX_AGE_MS alt ist, verfaellt. Fuer den Platz zaehlt die Frist ab
 * `heldAt`: Solange ein vorgezogener Blick einen Platz haelt, verfaellt ein
 * Ausloeser des Takts der langen Sperrzeit nicht.
 */
export function retryVerdict(ctx: RetryContext): "bewerten" | "warten" | SkipReason {
  const young = ctx.now - ctx.seenAt < RETRY_MAX_AGE_MS;
  if (ctx.lastInspectAt !== undefined && ctx.now - ctx.lastInspectAt < ctx.cooldownMs) return ctx.awaitsResult && young ? "warten" : "abstand";
  if (ctx.inspectionsLastHour >= ctx.maxPerHour) return "limit";
  if (ctx.now - Math.max(ctx.seenAt, ctx.heldAt ?? ctx.seenAt) >= RETRY_MAX_AGE_MS) return "belegt";
  return ctx.busy >= ctx.maxBusy ? "warten" : "bewerten";
}

/* ------------------------------------------------- Bilanz je Stunde */

export const HOUR_MS = 3_600_000;
/** So lange wartet die Bilanz einer abgelaufenen Stunde auf noch laufende Bewertungen. */
export const TALLY_GRACE_MS = 10 * 60_000;

/** Zaehler einer Stunde. Jeder Ausloeser endet als uebergangen oder mit einem Ergebnis. */
export interface SentinelTally {
  /** Beginn der Stunde (ms). */
  start: number;
  triggers: number;
  /** Begonnene Bewertungen. */
  inspected: number;
  /** Davon vorgezogen (isEarly): erst die kurze Sperrzeit hat sie moeglich gemacht. */
  early: number;
  skipped: Record<SkipReason, number>;
  outcomes: Record<InspectOutcome, number>;
}

export function newTally(now: number): SentinelTally {
  return {
    start: Math.floor(now / HOUR_MS) * HOUR_MS,
    triggers: 0,
    inspected: 0,
    early: 0,
    skipped: { abstand: 0, limit: 0, belegt: 0 },
    outcomes: { alarm: 0, kein_alarm: 0, unauffaellig: 0, tracker_leer: 0, nahaufnahme_leer: 0, fehler: 0 },
  };
}

const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

/** Ausloeser der Stunde, die noch warten oder gerade bewertet werden. */
export function tallyOpen(t: SentinelTally): number {
  return Math.max(0, t.triggers - sum(t.skipped) - sum(t.outcomes));
}

/**
 * Bilanz faellig? Wenn die Stunde vorbei ist und alle ihre Ausloeser
 * erledigt sind, spaetestens TALLY_GRACE_MS nach dem Ende der Stunde.
 */
export function tallyDue(t: SentinelTally, now: number): boolean {
  const end = t.start + HOUR_MS;
  return now >= end && (tallyOpen(t) === 0 || now >= end + TALLY_GRACE_MS);
}

const OUTCOME_TEXT: Array<[InspectOutcome, string]> = [
  ["alarm", "Alarm"],
  ["kein_alarm", "kein Alarm"],
  ["unauffaellig", "unauffällig"],
  ["tracker_leer", "Tracker leer"],
  ["nahaufnahme_leer", "Nahaufnahme leer"],
  ["fehler", "Fehler"],
];

/**
 * Bilanz-Zeile einer Stunde; null, wenn es keinen Ausloeser gab. `fromHour`
 * ist die Ortszeit-Stunde, in der die Bilanz beginnt (nicht lesbar: „1 h“).
 */
export function tallyLine(t: SentinelTally, fromHour: number): string | null {
  if (t.triggers <= 0) return null;
  const span = Number.isInteger(fromHour) && fromHour >= 0 && fromHour <= 23 ? `${fromHour}–${(fromHour + 1) % 24} Uhr` : "1 h";
  const skipped = sum(t.skipped);
  const results = OUTCOME_TEXT.filter(([key]) => t.outcomes[key] > 0).map(([key, text]) => `${t.outcomes[key]} ${text}`);
  const open = tallyOpen(t);
  if (open > 0) results.push(`${open} noch offen`);
  return (
    `Wächter ${span}: ${t.triggers} Auslöser, ${t.inspected} bewertet` +
    (t.early > 0 ? ` (davon ${t.early} nach kurzer Sperrzeit)` : "") +
    `, ${skipped} übergangen` +
    (skipped ? ` (Abstand ${t.skipped.abstand}, Limit ${t.skipped.limit}, belegt ${t.skipped.belegt})` : "") +
    (results.length ? `; ${results.join(", ")}` : "")
  );
}

/* ------------------------------------------------ Takt des Waechters */

/** Je Kamera: die letzte Bewertung und der Takt der langen Sperrzeit. */
export interface InspectMark {
  /** Beginn der letzten Bewertung. */
  at: number;
  /** Sperrzeit ab `at` nach ihrem Ergebnis (cooldownFor); die lange, solange das Ergebnis aussteht. */
  cooldownMs: number;
  /**
   * Beginn der Bewertung, ab der der Takt der langen Sperrzeit zaehlt: die
   * letzte, die nicht vorgezogen war, oder ein vorgezogener Blick mit Alarm.
   */
  regularAt: number;
  /** Das Ergebnis steht noch aus. */
  running: boolean;
}

/** Ein Ausloeser auf dem Weg zur Bewertung. */
export interface PendingTrigger {
  camId: number;
  where: string;
  title: string;
  /** Wann der Ausloeser zuerst gesehen wurde. */
  seenAt: number;
  /** Bilanz der Stunde, in der er kam: Dort zaehlt auch sein Ausgang. */
  tally: SentinelTally;
  /**
   * Letzter Takt, in dem dieser Ausloeser des Takts der langen Sperrzeit auf
   * einen Platz wartete, den ein vorgezogener Blick hielt. Ab hier zaehlt
   * RETRY_MAX_AGE_MS (retryVerdict).
   */
  heldAt?: number;
}

/** Eine begonnene Bewertung; `mark` ist die Sperrzeit, die sie fuer ihre Kamera gesetzt hat. */
export interface StartedInspection {
  trigger: PendingTrigger;
  mark: InspectMark;
  /** Vorgezogen (isEarly). */
  early: boolean;
}

/** Stand des Waechters zwischen den Takten (nur im Speicher). */
export interface SentinelQueue {
  marks: Map<number, InspectMark>;
  /** Beginn der Bewertungen der letzten Stunde (alle Kameras), ohne die vorgezogenen. */
  recent: number[];
  /** Beginn der vorgezogenen Bewertungen der letzten Stunde (alle Kameras). */
  early: number[];
  /** Laufende Bewertungen. */
  busy: number;
  /** Davon vorgezogen (isEarly). */
  busyEarly: number;
  /** Zurueckgestellte Ausloeser: hoechstens einer je Kamera, aeltester zuerst. */
  waiting: PendingTrigger[];
  /** Zaehler der laufenden Stunde. */
  tally: SentinelTally;
  /** Abgelaufene Stunden mit Ausloesern, deren Bilanz-Zeile noch aussteht. */
  closing: SentinelTally[];
}

export function newQueue(now: number): SentinelQueue {
  return { marks: new Map(), recent: [], early: [], busy: 0, busyEarly: 0, waiting: [], tally: newTally(now), closing: [] };
}

/**
 * Sperrzeit, die fuer die Kamera gerade gilt, gerechnet ab dem Beginn ihrer
 * letzten Bewertung. Die kurze Sperrzeit bringt zusaetzliche Blicke, sie
 * verschiebt den Takt der langen nicht: Spaetestens COOLDOWN_MS nach
 * `regularAt` ist die Kamera wieder dran, auch wenn ein vorgezogener Blick
 * gerade erst leer war. So laesst die Sperrzeit weiter jeden Ausloeser durch,
 * den die lange allein durchgelassen haette; nur nach einem vorgezogenen
 * Blick mit Alarm beginnt der Takt neu (finishInspection). Bewertet wird er,
 * sobald ein Platz frei ist: Haelt ein vorgezogener Blick den Platz, wartet
 * der Ausloeser so lange, statt nach RETRY_MAX_AGE_MS zu verfallen
 * (planTick, PendingTrigger.heldAt). Mit `earlyAllowed` = false (das
 * Stundenlimit laesst keine vorgezogenen Blicke mehr zu) gilt nur der Takt
 * der langen Sperrzeit.
 */
export function lockMs(mark: InspectMark, earlyAllowed = true): number {
  if (mark.running) return COOLDOWN_MS;
  const regular = mark.regularAt + COOLDOWN_MS - mark.at;
  return earlyAllowed ? Math.min(mark.cooldownMs, regular) : regular;
}

/**
 * Vorgezogen ist eine Bewertung, die erst die kurze Sperrzeit moeglich macht:
 * Sie beginnt weniger als COOLDOWN_MS nach `regularAt`.
 */
export function isEarly(mark: InspectMark | undefined, now: number): boolean {
  return mark !== undefined && now - mark.regularAt < COOLDOWN_MS;
}

/**
 * Der Takt der langen Sperrzeit ist dran, aber das Ergebnis eines
 * vorgezogenen Blicks auf dieselbe Kamera steht noch aus: Der Ausloeser wartet
 * es ab, statt uebergangen zu werden (zwei Bewertungen derselben Kamera laufen
 * nicht nebeneinander).
 */
export function awaitsResult(mark: InspectMark | undefined, now: number): boolean {
  return mark !== undefined && mark.running && now - mark.at < COOLDOWN_MS && now - mark.regularAt >= COOLDOWN_MS;
}

function rollTally(q: SentinelQueue, now: number): SentinelTally {
  if (now - q.tally.start >= HOUR_MS) {
    if (q.tally.triggers > 0) q.closing.push(q.tally);
    q.tally = newTally(now);
  }
  return q.tally;
}

/** Bilanzen abgelaufener Stunden, die jetzt faellig sind (jede genau einmal, nur Stunden mit Ausloesern). */
export function dueTallies(q: SentinelQueue, now: number): SentinelTally[] {
  rollTally(q, now);
  const due: SentinelTally[] = [];
  while (q.closing.length && tallyDue(q.closing[0], now)) due.push(q.closing.shift()!);
  return due;
}

export interface TickInput {
  now: number;
  hour: number;
  nightWindow: string;
  maxPerHour: number;
  /** So viele Bewertungen laufen hoechstens gleichzeitig. */
  maxBusy: number;
  /**
   * Neue Kamera-Ereignisse, deren Kamera bekannt ist. `always`:
   * HUB_AGENT_SENTINEL=always gilt fuer die Kamera (modeAlways).
   */
  events: Array<{ ev: SentinelEvent; camId: number; where: string; closed: boolean | null; always: boolean }>;
}

export interface TickPlan {
  /** Jetzt zu bewerten: Der Platz ist belegt, die Sperrzeit der Kamera gesetzt. */
  start: StartedInspection[];
  /** Zurueckgestellte Ausloeser, die verfallen sind. */
  expired: PendingTrigger[];
  /** Neue Ausloeser in diesem Takt. */
  triggers: number;
  /** In diesem Takt uebergangen, nach Grund. */
  skipped: Record<SkipReason, number>;
}

/**
 * Ein Takt: erst die zurueckgestellten Ausloeser, dann die neuen Ereignisse.
 * Jeder Ausloeser wird hoechstens einmal bewertet: Er steht entweder in
 * `start`, wartet (hoechstens einer je Kamera) oder ist mit einem Grund
 * uebergangen. Bis das Ergebnis einer Bewertung da ist (finishInspection),
 * gilt fuer ihre Kamera die lange Sperrzeit.
 *
 * Das Stundenlimit zaehlt die Bewertungen ohne die vorgezogenen. Vorgezogene
 * Blicke gibt es nur, solange alle Bewertungen der Stunde zusammen darunter
 * liegen; danach gilt fuer die Kamera wieder allein die lange Sperrzeit. So
 * bleibt jeder Kamera deren Takt, auch wenn eine Kamera nachts oft ausloest.
 *
 * Bei den Plaetzen geht der Takt der langen Sperrzeit vor: Wartet einer
 * seiner Ausloeser auf einen Platz, den ein vorgezogener Blick haelt,
 * verfaellt er nicht nach RETRY_MAX_AGE_MS, sondern wird bewertet, sobald ein
 * Platz frei ist. Die wartenden Ausloeser kommen vor den neuen dran.
 */
export function planTick(q: SentinelQueue, input: TickInput): TickPlan {
  const { now } = input;
  const plan: TickPlan = { start: [], expired: [], triggers: 0, skipped: { abstand: 0, limit: 0, belegt: 0 } };
  for (const list of [q.recent, q.early]) while (list.length && now - list[0] > HOUR_MS) list.shift();
  const lock = (mark: InspectMark | undefined) => (mark ? lockMs(mark, q.recent.length + q.early.length < input.maxPerHour) : COOLDOWN_MS);
  const skip = (tally: SentinelTally, reason: SkipReason) => {
    tally.skipped[reason]++;
    plan.skipped[reason]++;
  };
  const begin = (trigger: PendingTrigger) => {
    const prev = q.marks.get(trigger.camId);
    const early = isEarly(prev, now);
    const mark: InspectMark = { at: now, cooldownMs: COOLDOWN_MS, regularAt: early && prev ? prev.regularAt : now, running: true };
    q.marks.set(trigger.camId, mark);
    (early ? q.early : q.recent).push(now);
    q.busy++;
    if (early) q.busyEarly++;
    trigger.tally.inspected++;
    if (early) trigger.tally.early++;
    plan.start.push({ trigger, mark, early });
  };
  // Zurueckstellen und im naechsten Takt erneut versuchen. Wartet fuer die
  // Kamera schon ein Ausloeser, bleibt es bei dem.
  const park = (trigger: PendingTrigger, reason: SkipReason) => {
    if (q.waiting.some((w) => w.camId === trigger.camId)) skip(trigger.tally, reason);
    else q.waiting.push(trigger);
  };

  const pending = q.waiting;
  q.waiting = [];
  for (const w of pending) {
    const mark = q.marks.get(w.camId);
    // Haelt ein vorgezogener Blick einen Platz, laeuft die Wartefrist eines Ausloesers des langen Takts nicht ab.
    if (q.busyEarly > 0 && !isEarly(mark, now)) w.heldAt = now;
    const verdict = retryVerdict({
      seenAt: w.seenAt,
      heldAt: w.heldAt,
      now,
      busy: q.busy,
      maxBusy: input.maxBusy,
      lastInspectAt: mark?.at,
      cooldownMs: lock(mark),
      awaitsResult: awaitsResult(mark, now),
      inspectionsLastHour: q.recent.length,
      maxPerHour: input.maxPerHour,
    });
    if (verdict === "warten") {
      q.waiting.push(w);
    } else if (verdict === "bewerten") {
      begin(w);
    } else {
      if (verdict === "belegt") plan.expired.push(w);
      skip(w.tally, verdict);
    }
  }

  const tally = rollTally(q, now);
  for (const { ev, camId, where, closed, always } of input.events) {
    const mark = q.marks.get(camId);
    const verdict = triggerVerdict(ev, {
      closed,
      hour: input.hour,
      nightWindow: input.nightWindow,
      always,
      lastInspectAt: mark?.at,
      now,
      cooldownMs: lock(mark),
      inspectionsLastHour: q.recent.length,
      maxPerHour: input.maxPerHour,
    });
    if (verdict === "kein_ausloeser") continue;
    tally.triggers++;
    plan.triggers++;
    const trigger: PendingTrigger = { camId, where, title: ev.title, seenAt: now, tally };
    if (verdict === "abstand" && awaitsResult(mark, now)) park(trigger, "abstand");
    else if (verdict !== "bewerten") skip(tally, verdict);
    else if (q.busy < input.maxBusy) begin(trigger);
    else park(trigger, "belegt");
  }
  return plan;
}

/**
 * Ergebnis einer Bewertung verbuchen: Platz freigeben, Ergebnis in die
 * Bilanz, Sperrzeit der Kamera nach dem Ergebnis. Nach einem Alarm beginnt
 * der Takt der langen Sperrzeit neu. Laeuft fuer die Kamera schon eine neuere
 * Bewertung, bleibt deren Sperrzeit unberuehrt (sie hat ihre eigene Marke).
 */
export function finishInspection(q: SentinelQueue, started: StartedInspection, outcome: InspectOutcome, hour: number, nightWindow: string): void {
  q.busy = Math.max(0, q.busy - 1);
  if (started.early) q.busyEarly = Math.max(0, q.busyEarly - 1);
  started.trigger.tally.outcomes[outcome]++;
  const { mark } = started;
  mark.running = false;
  mark.cooldownMs = cooldownFor(outcome, hour, nightWindow);
  if (outcome === "alarm") mark.regularAt = mark.at;
}

/* ------------------------------------------------ Kennzeichen-Fragen neben dem Takt */

/** So viele Fahrzeug-Ereignisse warten hoechstens auf den naechsten Lauf der Kennzeichen-Fragen (vehicleTick). */
export const VEHICLE_BACKLOG_MAX = 300;

/**
 * Ereignisse an den Puffer fuer den naechsten Lauf haengen, in ihrer
 * Reihenfolge. Mehr als `max` behaelt der Puffer nicht: Die aeltesten fallen
 * weg, `dropped` zaehlt sie.
 */
export function appendBacklog<T>(backlog: readonly T[], add: readonly T[], max = VEHICLE_BACKLOG_MAX): { list: T[]; dropped: number } {
  const all = [...backlog, ...add];
  const dropped = Math.max(0, all.length - Math.max(0, max));
  return { list: all.slice(dropped), dropped };
}

export interface Verdict {
  auffaellig: boolean;
  was: string;
  dringlichkeit: "niedrig" | "mittel" | "hoch";
}

/* ------------------------------------------- Personen: zweiter Blick */

/**
 * Zusaetzliche Standbilder des zweiten Blicks, gerechnet ab dem ersten Bild.
 * Sie entstehen neben dem Aufruf des Bildmodells: Nachts ist eine Person oft
 * nur wenige Sekunden im Bild, das Urteil kommt spaeter.
 */
export const SECOND_LOOK_DELAYS_MS: readonly number[] = [3_000, 8_000];
/** So lange nach dem Ausloeser wartet der Tracker-Gegencheck auf ein Gesichts-Ereignis der Kamera. */
export const FACE_WAIT_MS = 30_000;
/**
 * Ab so lange vor dem Ausloeser belegt ein Gesichts-Ereignis der Kamera
 * (bekannt oder unbekannt), dass dort jemand ist (trackerVeto,
 * emptyLookOverruled). Es entlastet niemanden, darum gilt das lange Fenster;
 * fuer die Entlastung durch ein bekanntes Gesicht gilt FACE_LEAD_MS.
 */
export const FACE_PRESENCE_LEAD_MS = 90_000;

/**
 * Ist „unauffaellig“ noch nicht endgueltig? Im Nachtfenster gilt das Urteil
 * des Bildmodells bei einem PERSON-Ausloeser erst, wenn auch der Tracker auf
 * dem ersten Bild und auf zwei weiteren Standbildern niemanden sieht
 * (secondLookResult). Ist die Stunde nicht lesbar, wird ebenfalls
 * nachgesehen. Fahrzeuge und Tagesstunden: wie bisher ein Blick.
 */
export function needsSecondLook(ctx: { isPerson: boolean; gateAuffaellig: boolean; hour: number; nightWindow: string }): boolean {
  if (!ctx.isPerson || ctx.gateAuffaellig) return false;
  return !Number.isFinite(ctx.hour) || inQuietHours(ctx.nightWindow, ctx.hour);
}

/**
 * Ergebnis des zweiten Blicks aus den Personenzahlen des Trackers je Bild
 * (erstes Bild zuerst; null = Bild oder Tracker nicht verfuegbar): Nummer des
 * ersten Bildes mit einer Person, mit dem die Bewertung weiterlaeuft;
 * „leer“, wenn jedes Bild geprueft und leer ist; „offen“, wenn keins eine
 * Person zeigt, aber nicht jedes geprueft werden konnte.
 */
export function secondLookResult(counts: ReadonlyArray<number | null>): number | "leer" | "offen" {
  const hit = counts.findIndex((n) => typeof n === "number" && n > 0);
  if (hit >= 0) return hit;
  return counts.length > 0 && counts.every((n) => n === 0) ? "leer" : "offen";
}

/**
 * Tracker-Gegencheck: Das Bildmodell nennt das Bild auffaellig, der Tracker
 * prueft, ob ueberhaupt jemand im Bild ist. Kein Alarm nur, wenn beide
 * Tracker-Ergebnisse leer sind (Personenzahl 0; null = nicht erreichbar, dann
 * kein Veto) und die Gesichtserkennung an dieser Kamera seit
 * FACE_PRESENCE_LEAD_MS vor dem Ausloeser kein Gesicht gemeldet hat, bekannt
 * oder unbekannt.
 */
export function trackerVeto(ctx: { first: number | null; second: number | null; faceSeenAt: number | null; triggerAt: number }): boolean {
  if (ctx.first !== 0 || ctx.second !== 0) return false;
  return !faceSince(ctx.faceSeenAt, ctx.triggerAt);
}

/** Hat die Gesichtserkennung an der Kamera seit FACE_PRESENCE_LEAD_MS vor dem Ausloeser ein Gesicht gemeldet? */
function faceSince(faceSeenAt: number | null, triggerAt: number): boolean {
  return typeof faceSeenAt === "number" && faceSeenAt >= triggerAt - FACE_PRESENCE_LEAD_MS;
}

/** Was eine Person belegt, wenn die Nahaufnahme niemanden zeigt. */
export type PresenceSignal = "gesicht" | "tracker";

/**
 * Darf „Auf der Nahaufnahme keine Person“ entwarnen? Nicht, wenn etwas
 * anderes eine Person belegt: ein Gesichts-Ereignis der Kamera seit
 * FACE_PRESENCE_LEAD_MS vor dem Ausloeser (zu jeder Stunde) oder, im Nachtfenster wie
 * beim zweiten Blick, eine Person, die der Tracker gesehen hat. null = nichts
 * spricht dagegen.
 */
export function emptyLookOverruled(ctx: {
  trackerCount: number | null;
  faceSeenAt: number | null;
  triggerAt: number;
  hour: number;
  nightWindow: string;
}): PresenceSignal | null {
  if (faceSince(ctx.faceSeenAt, ctx.triggerAt)) return "gesicht";
  const night = !Number.isFinite(ctx.hour) || inQuietHours(ctx.nightWindow, ctx.hour);
  return night && typeof ctx.trackerCount === "number" && ctx.trackerCount > 0 ? "tracker" : null;
}

/** Wie es nach „unauffaellig“ des Bildmodells weitergeht (afterCalm). */
export type CalmNext =
  /** Es bleibt bei „unauffaellig“. */
  | { then: "unauffaellig" }
  /** Weiter mit dem Bild des zweiten Blicks, auf dem der Tracker eine Person sieht. */
  | { then: "tracker"; shot: number }
  /** Weiter mit dem ersten Bild: Die Gesichtserkennung hat an der Kamera ein Gesicht gefunden. */
  | { then: "gesicht" }
  /** Weiter mit dem ersten Bild: Der Tracker konnte nicht jedes Bild des zweiten Blicks pruefen. */
  | { then: "offen" };

/**
 * Ist „unauffaellig“ endgueltig? Bei einem PERSON-Ausloeser nicht, wenn etwas
 * eine Person belegt: der Tracker auf einem Bild des zweiten Blicks (nachts,
 * secondLookResult) oder, zu jeder Stunde, ein Gesichts-Ereignis der Kamera
 * seit FACE_PRESENCE_LEAD_MS vor dem Ausloeser, bekannt oder unbekannt. Dann
 * laeuft die Bewertung weiter. Konnte der Tracker nachts nicht jedes Bild
 * pruefen, ebenfalls. `secondLook` = null: kein zweiter Blick (Tag, Fahrzeug).
 */
export function afterCalm(ctx: {
  isPerson: boolean;
  secondLook: number | "leer" | "offen" | null;
  faceSeenAt: number | null;
  triggerAt: number;
}): CalmNext {
  if (typeof ctx.secondLook === "number") return { then: "tracker", shot: ctx.secondLook };
  if (ctx.isPerson && faceSince(ctx.faceSeenAt, ctx.triggerAt)) return { then: "gesicht" };
  if (ctx.secondLook === "offen") return { then: "offen" };
  return { then: "unauffaellig" };
}

/** Antwort des Bildmodells robust lesen (JSON, notfalls aus Text). */
export function parseVerdict(raw: string): Verdict {
  let obj: Record<string, unknown> = {};
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      obj = JSON.parse(m[0]) as Record<string, unknown>;
    } catch {
      obj = {};
    }
  }
  const flag = obj.auffaellig ?? obj.auffällig ?? obj.suspicious;
  const auffaellig = flag === true || flag === "true" || flag === "ja";
  const d = String(obj.dringlichkeit ?? "niedrig").toLowerCase();
  return {
    auffaellig,
    was: String(obj.was ?? obj.beschreibung ?? raw).replace(/\s+/g, " ").trim().slice(0, 400),
    dringlichkeit: d === "hoch" || d === "mittel" ? d : "niedrig",
  };
}

/* ------------------------------------------------- Personen: Mitarbeiter? */

/**
 * Was die Person laut Nahaufnahme tut (Feld „handlung“ der Antwort). Die
 * ersten sechs Werte fragt der Prompt ab, die letzten beiden entstehen beim
 * Lesen:
 *  - verdaechtig: Antwort im alten Format („verdaechtig“: ja, ohne Handlung).
 *  - unklar: ein Wert, der keinem festen Wert zuzuordnen ist.
 */
export type Handlung = "klettern" | "tuer_fenster_schloss" | "versteckt" | "vermummt" | "traegt_etwas" | "keine" | "verdaechtig" | "unklar";

/** Reihenfolge nach Schwere: Nennt die Antwort mehrere Werte, gilt der schwerste. */
const ACTION_ORDER: readonly Handlung[] = ["klettern", "tuer_fenster_schloss", "versteckt", "verdaechtig", "unklar", "vermummt", "traegt_etwas", "keine"];

/**
 * Harte Handlungen loesen immer Alarm aus, auch bei erkannten, freigegebenen
 * oder eingestempelten Personen. Eine Antwort im alten Format und ein Wert,
 * der sich nicht zuordnen laesst, zaehlen dazu: Im Zweifel Alarm.
 */
export const HARD_ACTIONS: ReadonlySet<Handlung> = new Set<Handlung>(["klettern", "tuer_fenster_schloss", "versteckt", "verdaechtig", "unklar"]);

/** Kurztext fuer Grund und Log. */
export const ACTION_TEXT: Record<Handlung, string> = {
  klettern: "klettert",
  tuer_fenster_schloss: "hantiert an Tür, Fenster oder Schloss",
  versteckt: "versteckt sich",
  verdaechtig: "Verhalten wirkt verdächtig",
  unklar: "Handlung nicht eindeutig",
  vermummt: "vermummt",
  traegt_etwas: "trägt etwas",
  keine: "keine",
};

/** Freie Schreibweisen der Antwort, in der Reihenfolge nach Schwere. */
const ACTION_WORDS: Array<[Handlung, RegExp]> = [
  ["klettern", /kletter/],
  ["tuer_fenster_schloss", /tuer(?!kis)|fenster|schloss/],
  ["versteckt", /versteck/],
  ["vermummt", /vermumm|maskiert|sturmhaube/],
  ["traegt_etwas", /traeg|tragen|schlepp/],
  ["keine", /^(keine?|keine_handlung|nichts|none|nein|-)$/],
];

/** Ein einzelner Wert der Antwort; null = kein Wert. */
function actionOf(v: unknown): Handlung | null {
  if (v === null || v === undefined) return null;
  if (v === false) return "keine";
  const s = String(v)
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .trim()
    .replace(/[\s,/-]+/g, "_");
  if (!s) return null;
  if ((ACTION_ORDER as readonly string[]).includes(s) && s !== "verdaechtig" && s !== "unklar") return s as Handlung;
  for (const [action, re] of ACTION_WORDS) if (re.test(s)) return action;
  return "unklar";
}

/**
 * Feld „handlung“ lesen: ein Wert oder eine Liste (dann gilt der schwerste).
 * null = die Antwort nennt keine Handlung.
 */
export function readHandlung(v: unknown): Handlung | null {
  const values = (Array.isArray(v) ? v : [v]).map(actionOf).filter((a): a is Handlung => a !== null);
  if (!values.length) return null;
  return values.reduce((a, b) => (ACTION_ORDER.indexOf(b) < ACTION_ORDER.indexOf(a) ? b : a));
}

/** Nahaufnahme-Bewertung einer Person (Bildmodell, JSON). */
export interface PersonLook {
  personen: number;
  arbeitskleidung: boolean;
  mitarbeiter: boolean;
  /** Was die Person tut; „keine“, wenn die Antwort nichts nennt. */
  handlung: Handlung;
  /** Bei „unklar“: der Wert, wie ihn die Antwort nennt (fuer Grund und Log). */
  handlungText?: string;
  was: string;
  /** Kurzbeschreibung je Person (Kleidung, Statur) fuer die Wiedererkennung. */
  kleidung: string[];
  /** Nummern der schon bekannten Personen (aus der Liste im Prompt), die wieder zu sehen sind. */
  bekannt: number[];
  /** Personen im Bild, die keiner bekannten entsprechen. */
  unbekannt: number;
}

export function parsePersonLook(raw: string): PersonLook {
  let obj: Record<string, unknown> = {};
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      obj = JSON.parse(m[0]) as Record<string, unknown>;
    } catch {
      obj = {};
    }
  }
  const yes = (v: unknown) => v === true || v === "true" || v === "ja";
  const n = Math.round(Number(obj.personen));
  const personen = Number.isFinite(n) && n >= 0 ? Math.min(n, 50) : 1;
  const kleidung = (Array.isArray(obj.kleidung) ? obj.kleidung : typeof obj.kleidung === "string" ? [obj.kleidung] : [])
    .map((k) => String(k).replace(/\s+/g, " ").trim().slice(0, 160))
    .filter(Boolean)
    .slice(0, 10);
  const bekannt = (Array.isArray(obj.bekannt) ? obj.bekannt : [])
    .map((b) => Math.round(Number(b)))
    .filter((b, i, a) => Number.isInteger(b) && b > 0 && a.indexOf(b) === i);
  const u = Math.round(Number(obj.unbekannt));
  const unbekannt = Number.isFinite(u) && u >= 0 ? u : Math.max(0, personen - bekannt.length);
  // Das alte Feld „verdaechtig“ gilt weiter: Ein Ja ohne Handlung zaehlt wie
  // bisher als verdaechtig, ebenso ein Ja neben „keine“ (Widerspruch, im
  // Zweifel Alarm). Nennt die Antwort eine Handlung, entscheidet diese.
  const rawAction = obj.handlung ?? obj.handlungen;
  const said = readHandlung(rawAction);
  const legacy = yes(obj.verdaechtig ?? obj.verdächtig);
  const handlung: Handlung = legacy && (said === null || said === "keine") ? "verdaechtig" : (said ?? "keine");
  const handlungText =
    handlung === "unklar"
      ? (Array.isArray(rawAction) ? rawAction.map(String).join(", ") : String(rawAction)).replace(/\s+/g, " ").trim().slice(0, 60)
      : undefined;
  return {
    personen,
    kleidung,
    bekannt,
    unbekannt,
    arbeitskleidung: yes(obj.arbeitskleidung),
    mitarbeiter: yes(obj.mitarbeiter ?? obj.wirkt_wie_mitarbeiter),
    handlung,
    ...(handlungText ? { handlungText } : {}),
    was: String(obj.was ?? obj.beschreibung ?? "").replace(/\s+/g, " ").trim().slice(0, 400),
  };
}

/** Gesichts-Treffer der bestehenden Gesichtserkennung an einer Kamera. */
export interface FaceHit {
  name: string;
  /** WHITELIST | BLACKLIST */
  list: string;
  /** Score des Treffers; fehlt bei Ereignissen eines aelteren Stands. */
  score?: number;
  /** Aus einem hochgerechneten Mini-Gesicht; fehlt bei Ereignissen eines aelteren Stands. */
  upscaled?: boolean;
}

/** Starker Treffer: nicht hochgerechnet und mindestens dieser Score … */
export const FACE_STRONG_DIRECT = 0.6;
/** … oder, auch hochgerechnet, mindestens dieser. */
export const FACE_STRONG_ANY = 0.7;

/**
 * Ist der Gesichts-Treffer stark genug, um allein zu entwarnen? Fehlen Score
 * oder die Angabe „hochgerechnet“ (Ereignis eines aelteren Stands), gilt er
 * als schwach.
 */
export function faceIsStrong(hit: Pick<FaceHit, "score" | "upscaled">): boolean {
  const { score, upscaled } = hit;
  if (typeof score !== "number" || !Number.isFinite(score) || typeof upscaled !== "boolean") return false;
  return score >= FACE_STRONG_ANY || (!upscaled && score >= FACE_STRONG_DIRECT);
}

/** Score fuer Grund und Log: „0,55“, ohne Score „unbekannt“. */
function scoreText(score: number | undefined): string {
  return typeof score === "number" && Number.isFinite(score) ? score.toFixed(2).replace(".", ",") : "unbekannt";
}

/**
 * Ab so lange vor dem Ausloeser zaehlt ein Gesichts-Ereignis der Kamera zur
 * Bewertung, bis zur Entscheidung. Ein frueheres Gesicht gehoert eher zu
 * einem Passanten, der schon weiter ist.
 */
export const FACE_LEAD_MS = 10_000;
/**
 * Ein Treffer der Sperrliste zaehlt ab so lange vor dem Ausloeser: Er
 * loest Alarm aus und entlastet niemanden, darum gilt fuer ihn das laengere
 * Fenster.
 */
export const BLACKLIST_LEAD_MS = 90_000;

/** Ein Gesichts-Treffer mit Zeitpunkt (people.ts merkt sich alle Treffer je Kamera). */
export interface TimedFaceHit extends FaceHit {
  at: number;
}

/**
 * Gesichts-Treffer fuer die Bewertung eines Ausloesers. Ein Treffer der
 * Sperrliste ab BLACKLIST_LEAD_MS vor `triggerAt` gewinnt immer, auch gegen
 * einen spaeteren Whitelist-Treffer. Sonst gilt der staerkste Whitelist-
 * Treffer ab FACE_LEAD_MS vor `triggerAt`: stark vor schwach, dann der
 * hoechste Score, dann der juengste.
 */
export function pickFaceHit(hits: readonly TimedFaceHit[], triggerAt: number): FaceHit | null {
  const recent = hits.filter((h) => h.at >= triggerAt - FACE_LEAD_MS);
  const strip = ({ at: _at, ...hit }: TimedFaceHit): FaceHit => hit;
  const black = hits.filter((h) => h.list === "BLACKLIST" && h.at >= triggerAt - BLACKLIST_LEAD_MS);
  if (black.length) return strip(black[black.length - 1]);
  const rank = (h: TimedFaceHit) => [faceIsStrong(h) ? 1 : 0, typeof h.score === "number" && Number.isFinite(h.score) ? h.score : -1, h.at];
  let best: TimedFaceHit | null = null;
  for (const h of recent) {
    if (h.list !== "WHITELIST") continue;
    if (!best) {
      best = h;
      continue;
    }
    const [a, b] = [rank(h), rank(best)];
    const i = a.findIndex((v, k) => v !== b[k]);
    if (i >= 0 && a[i] > b[i]) best = h;
  }
  return best ? strip(best) : null;
}

/**
 * Personen im Bild: die hoechste Zahl aus Nahaufnahme und Tracker
 * (Uebersichtsbild). null = keine der beiden Zahlen bekannt.
 */
export function personCount(look: Pick<PersonLook, "personen"> | null, tracked: number | null | undefined): number | null {
  const counts = [look?.personen, tracked].filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  return counts.length ? Math.max(...counts) : null;
}

/** Art eines Eintrags der Merkliste (people-rules.ts). */
type KnownKind = "gemeldet" | "freigegeben" | "mitarbeiter";

export interface PersonContext {
  /** Gesichts-Treffer der bestehenden Gesichtserkennung an dieser Kamera. */
  face: FaceHit | null;
  /** Eingestempelte Mitarbeiter (null = keine aktuellen Daten). */
  staff: string[] | null;
  look: PersonLook | null;
  hour: number;
  /** Namen/Beschreibungen der bekannten Personen in Listen-Reihenfolge (1-basiert in look.bekannt). */
  known?: string[];
  /** Art der bekannten Eintraege in derselben Reihenfolge wie `known`; fehlt sie, gilt keiner als freigegeben. */
  knownKinds?: KnownKind[];
  /** Personen laut Tracker auf dem Uebersichtsbild; null = unbekannt. */
  tracked?: number | null;
  /** Belegt etwas eine Person, auch wenn die Nahaufnahme niemanden zeigt (emptyLookOverruled)? */
  presence?: PresenceSignal | null;
}

/**
 * Kurzform des Grunds einer Personen-Entscheidung. Die Merkliste
 * (people-rules.ts) richtet sich danach, was sie sich merkt: Der Text in
 * `reason` ist fuer Menschen und kann sich aendern.
 */
export type ClearBasis =
  /** Starker Gesichts-Treffer auf der Whitelist, hoechstens eine Person im Bild. */
  | "gesicht"
  /**
   * Schwacher Whitelist-Treffer als Hinweis, zusammen mit einem zweiten
   * Signal, hoechstens eine Person im Bild. Daraus wird keine Freigabe.
   */
  | "hinweis"
  /** Alle Personen im Bild stehen schon auf der Merkliste. */
  | "bekannt"
  /** Auf der Nahaufnahme ist niemand. */
  | "leer"
  /** Wirkt wie Mitarbeiter bei der Arbeit (tagsueber, ohne Stempeldaten). */
  | "arbeit"
  /** Hoechstens so viele Personen wie eingestempelt. */
  | "eingestempelt";

export type AlarmBasis =
  /** Gesicht auf der Sperrliste. */
  | "gesperrt"
  /** Harte Handlung (HARD_ACTIONS): Klettern, Hantieren an Tuer/Fenster/Schloss, Verstecken. */
  | "verdaechtig"
  /** Traegt etwas oder ist vermummt, ohne dass etwas die Person entlastet. */
  | "ohne_freigabe"
  /** Mehr Personen als eingestempelt. */
  | "ueberzahl"
  /** Eingestempelt, aber nachts und ohne Arbeitskleidung. */
  | "nachts"
  /** Niemand eingestempelt. */
  | "niemand"
  /** Keine Stempeldaten. */
  | "keine_daten";

export type PersonBasis = ClearBasis | AlarmBasis;

export type PersonDecision =
  | { alarm: true; reason: string; basis: AlarmBasis }
  | { alarm: false; reason: string; basis: ClearBasis };

/** Tagsueber (6–20 Uhr) arbeiten Mitarbeiter auch ausserhalb der Oeffnungszeit. */
const WORK_HOURS = (h: number) => h >= 6 && h < 20;

/**
 * Person ausserhalb des Betriebs: Alarm oder vermutlich Mitarbeiter?
 * Wichtigstes Signal sind eingestempelte Mitarbeiter, dazu Arbeitskleidung,
 * Taetigkeit und Uhrzeit. Blacklist und harte Handlungen (Klettern,
 * Hantieren an Tuer, Fenster oder Schloss, Verstecken) schlagen immer Alarm.
 *
 * Gesichts-Treffer auf der Whitelist der bestehenden Gesichtserkennung:
 * Allein entwarnt nur ein starker Treffer (faceIsStrong), und nur, wenn
 * Nahaufnahme und Tracker hoechstens eine Person zaehlen. Die
 * Gesichtserkennung vergleicht je Bild ein Gesicht; bei zwei oder mehr
 * Personen entwarnt ein Gesicht deshalb nie allein. Ein schwacher Treffer ist
 * ein Hinweis: Er entwarnt nur bei hoechstens einer Person und zusammen mit
 * einem zweiten Signal (eingestempeltes Personal; tagsueber Arbeitskleidung
 * oder Taetigkeit laut Bildmodell; auf der Merkliste als freigegeben). Der
 * Grund nennt dann „vermutlich bekannt“ mit dem Score, ohne Namen.
 *
 * Traegt die Person etwas, gibt es keinen Alarm nur, wenn sie erkannt ist
 * (starker Gesichts-Treffer, hoechstens eine Person im Bild), alle Personen im
 * Bild freigegeben sind oder tagsueber passendes Personal eingestempelt ist.
 * Eine Vermummung entlastet kein Gesichts-Treffer (er kann von einer anderen
 * Person im Bild stammen), nur eine Freigabe oder eingestempeltes Personal am
 * Tag, und nur bei genau einer Person im Bild. Das ist strenger als fuer
 * „traegt etwas“ und so gewollt: Ohne Alarm bleibt laut Entscheidung des
 * Betreibers nur, wer erkannt oder freigegeben ist und nur etwas traegt; eine
 * vermummte Person mit Gesichts-Treffer meldet der Waechter so, wie er sie
 * meldete, als das Bildmodell sie verdaechtig nannte (Test „Vermummt, Gesicht
 * erkannt“).
 */
export function decidePerson(ctx: PersonContext): PersonDecision {
  if (ctx.face?.list === "BLACKLIST") return { alarm: true, basis: "gesperrt", reason: `Gesperrte Person erkannt: ${ctx.face.name}` };
  const act = ctx.look?.handlung ?? "keine";
  if (HARD_ACTIONS.has(act)) {
    const text = act === "unklar" && ctx.look?.handlungText ? `${ACTION_TEXT.unklar} („${ctx.look.handlungText}“)` : ACTION_TEXT[act];
    return { alarm: true, basis: "verdaechtig", reason: act === "verdaechtig" ? ACTION_TEXT.verdaechtig : `Verhalten wirkt verdächtig: ${text}` };
  }
  const known = ctx.known ?? [];
  const kinds = ctx.knownKinds ?? [];
  const seen = (ctx.look?.bekannt ?? []).filter((b) => b <= known.length);
  const allSeen = !!ctx.look && seen.length > 0 && ctx.look.unbekannt === 0;
  const released = allSeen && seen.every((b) => kinds[b - 1] === "freigegeben");
  const staffList = ctx.staff ?? [];
  const staffByDay = staffList.length > 0 && (ctx.look?.personen ?? 1) <= staffList.length && WORK_HOURS(ctx.hour);
  const count = personCount(ctx.look, ctx.tracked);
  const white = ctx.face?.list === "WHITELIST" ? ctx.face : null;
  const recognized = !!white && faceIsStrong(white) && count !== null && count <= 1;
  if (act === "traegt_etwas" && !(recognized || released || staffByDay)) {
    const reason = "Trägt etwas und ist weder erkannt noch freigegeben";
    return { alarm: true, basis: "ohne_freigabe", reason: white ? `${reason} – ${faceNote(white, count)}` : reason };
  }
  if (act === "vermummt" && !(count === 1 && (released || staffByDay))) {
    return { alarm: true, basis: "ohne_freigabe", reason: "Vermummt und weder freigegeben noch eingestempelt" };
  }
  const face = act === "vermummt" ? null : white;
  const d = decideKnown(ctx, { white: face, seen, allSeen, known, kinds, count });
  if (d.alarm) {
    const notes = [face ? faceNote(face, count) : "", ctx.look?.personen === 0 && ctx.presence ? PRESENCE_NOTE[ctx.presence] : ""].filter(Boolean);
    return notes.length ? { ...d, reason: `${d.reason} – ${notes.join("; ")}` } : d;
  }
  return act === "keine" ? d : { ...d, reason: `${d.reason} (${ACTION_TEXT[act]})` };
}

const PRESENCE_NOTE: Record<PresenceSignal, string> = {
  gesicht: "Nahaufnahme ohne Person, die Gesichtserkennung hat aber ein Gesicht gefunden",
  tracker: "Nahaufnahme ohne Person, der Tracker sieht aber jemanden",
};

/**
 * Zweites Signal zu einem schwachen Gesichts-Treffer: eingestempeltes
 * Personal; tagsueber Arbeitskleidung oder Taetigkeit laut Bildmodell (nachts
 * nicht); eine Person der Merkliste, die als freigegeben gilt. null = keins.
 */
function secondSignal(ctx: PersonContext, seen: number[], kinds: KnownKind[]): string | null {
  if ((ctx.staff ?? []).length > 0) return "eingestempelt";
  if (ctx.look && WORK_HOURS(ctx.hour)) {
    if (ctx.look.arbeitskleidung) return "Arbeitskleidung";
    if (ctx.look.mitarbeiter) return "wirkt wie Mitarbeiter bei der Arbeit";
  }
  if (seen.some((b) => kinds[b - 1] === "freigegeben")) return "schon gesehen als freigegeben";
  return null;
}

/** Warum ein Whitelist-Treffer nicht entwarnt hat (ohne Namen). */
function faceNote(face: FaceHit, count: number | null): string {
  const score = scoreText(face.score);
  if (!faceIsStrong(face)) return `Gesicht vermutlich bekannt (Score ${score}), allein zu unsicher`;
  return count === null ? `Gesicht erkannt (Score ${score}), Personenzahl unbekannt` : `Gesicht erkannt (Score ${score}), aber ${count} Personen im Bild`;
}

/** decidePerson ohne Handlung: Gesicht, Merkliste, Stempeldaten, Uhrzeit. */
function decideKnown(
  ctx: PersonContext,
  s: { white: FaceHit | null; seen: number[]; allSeen: boolean; known: string[]; kinds: KnownKind[]; count: number | null },
): PersonDecision {
  const { seen, known } = s;
  if (s.white && s.count !== null && s.count <= 1) {
    const score = scoreText(s.white.score);
    if (faceIsStrong(s.white)) return { alarm: false, basis: "gesicht", reason: `Gesicht erkannt: ${s.white.name} (Score ${score})` };
    const signal = secondSignal(ctx, seen, s.kinds);
    if (signal) return { alarm: false, basis: "hinweis", reason: `Vermutlich bekannt (Score ${score}), ${signal}` };
  }
  // Schon an einer anderen Kamera als unbedenklich eingestuft (gleiche Kleidung).
  if (ctx.look && s.allSeen) {
    return { alarm: false, basis: "bekannt", reason: `Schon gesehen: ${seen.map((b) => known[b - 1]).join(", ")}` };
  }
  // Nahaufnahme ohne Person (Fehlausloesung, Person schon weg): kein Alarm,
  // ausser Gesichtserkennung oder (nachts) Tracker belegen eine Person.
  if (ctx.look && ctx.look.personen === 0 && !ctx.presence) return { alarm: false, basis: "leer", reason: "Auf der Nahaufnahme keine Person" };
  // Ohne Stempeldaten: tagsueber genuegt das Bild (Arbeitskleidung/Taetigkeit).
  if (ctx.staff === null && ctx.look && (ctx.look.mitarbeiter || ctx.look.arbeitskleidung) && WORK_HOURS(ctx.hour)) {
    return { alarm: false, basis: "arbeit", reason: "Wirkt wie Mitarbeiter bei der Arbeit (keine Stempeldaten)" };
  }
  const staff = ctx.staff ?? [];
  if (staff.length > 0) {
    const count = ctx.look?.personen ?? 1;
    const looksStaff = !!ctx.look && (ctx.look.mitarbeiter || ctx.look.arbeitskleidung);
    if (count <= staff.length && (looksStaff || WORK_HOURS(ctx.hour))) {
      return { alarm: false, basis: "eingestempelt", reason: `Eingestempelt: ${staff.join(", ")}` };
    }
    return count > staff.length
      ? { alarm: true, basis: "ueberzahl", reason: `${count} Personen, aber nur ${staff.length} eingestempelt (${staff.join(", ")})` }
      : { alarm: true, basis: "nachts", reason: `Eingestempelt: ${staff.join(", ")}, aber nachts und ohne Arbeitskleidung` };
  }
  return ctx.staff === null
    ? { alarm: true, basis: "keine_daten", reason: "Keine Stempeldaten" }
    : { alarm: true, basis: "niemand", reason: "Niemand eingestempelt" };
}
