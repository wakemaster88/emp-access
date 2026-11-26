/**
 * Halteverbot: Was die Cloud mit einer Meldung des Hubs tut.
 *
 * Ein Hub ab dieser Version entscheidet selbst, ob eine Meldung in die
 * Historie gehört (`store`) und ob jemand benachrichtigt wird (`notify`);
 * er kennt Episode, Erinnerungen und Nachtruhe. Ein älterer Hub schickt diese
 * Angaben nicht und meldet ein stehendes Fahrzeug alle paar Minuten neu –
 * für ihn gilt die Sperre wie bisher, zusätzlich über die Datenbank, weil
 * der Merker im Speicher nur für eine Server-Instanz gilt.
 *
 * Reine Funktionen ohne Datenbank, damit sie sich testen lassen.
 */

/** Ein Fahrzeug steht dort oft eine Weile – ohne Sperre käme im Minutentakt Post. */
export const COOLDOWN_MINUTES = 10;

/**
 * Sperre über die letzte Halteverbot-Sichtung der Kamera in der Datenbank
 * (älterer Hub). Etwas kürzer als COOLDOWN_MINUTES, damit die Meldung eines
 * älteren Hubs alle 10 Minuten nicht an der Sperre hängen bleibt.
 */
export const DB_COOLDOWN_MINUTES = 9;

/** Angaben eines neueren Hubs; `null`, wo ein älterer Hub nichts schickt. */
export interface HubParkingParams {
  notify: boolean | null;
  store: boolean | null;
  /** Fahrzeuge in der Fläche (auch schon gemeldete). */
  inZone: number | null;
  /** Nummer der Erinnerung (1, 2, 3), sonst null. */
  reminder: number | null;
  /**
   * Schlüssel der Meldung (Hub ab dieser Version): gleich bei jedem Versuch
   * derselben Meldung. `storeKey` gilt dem Eintrag in der Historie,
   * `notifyKey` der Nachricht.
   */
  storeKey: string | null;
  notifyKey: string | null;
  /**
   * Erste Nachricht ohne neuen Eintrag (etwa nachts gespeichert, Nachricht
   * um 7 Uhr): Schlüssel des gespeicherten Eintrags, dessen Ausschnitt mit
   * an Telegram geht. Ältere Hubs schicken ihn nicht.
   */
  evidenceKey: string | null;
}

/** Schlüssel vom Hub: Ziffern, Buchstaben und . : _ -, höchstens 160 Zeichen. */
const KEY_RE = /^[0-9A-Za-z.:_-]{1,160}$/;

function key(v: string | null): string | null {
  return v != null && KEY_RE.test(v) ? v : null;
}

function flag(v: string | null): boolean | null {
  if (v === "1") return true;
  if (v === "0") return false;
  return null;
}

function count(v: string | null): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export function parseHubParkingParams(q: URLSearchParams): HubParkingParams {
  const reminder = count(q.get("reminder"));
  return {
    notify: flag(q.get("notify")),
    store: flag(q.get("store")),
    inZone: count(q.get("inZone")),
    reminder: reminder && reminder > 0 ? reminder : null,
    storeKey: key(q.get("storeKey")),
    notifyKey: key(q.get("notifyKey")),
    evidenceKey: key(q.get("evidenceKey")),
  };
}

/**
 * Wiederholter Versuch mit dem Bild des ersten (Hub ab dieser Version,
 * `retry=1`): Es ist älter als das aktuelle Kamerabild und wird nicht als
 * solches gesetzt. Ältere Clouds kennen die Angabe nicht.
 */
export function repeatsFirstImage(q: URLSearchParams): boolean {
  return q.get("retry") === "1";
}

/** Was eine Meldung an der Kamera setzt: das Kamerabild nur beim ersten Versuch, „zuletzt gesehen“ immer. */
export function cameraUpdateForReport<T>(snapshot: T, at: Date, retry: boolean): { snapshot?: T; snapshotAt?: Date; lastSeenAt: Date } {
  return retry ? { lastSeenAt: at } : { snapshot, snapshotAt: at, lastSeenAt: at };
}

/**
 * Antwort der Route auf eine Meldung: 502, wenn nachweislich nichts
 * zugestellt wurde (der Hub versucht es erneut), sonst 200. Mit Sichtung
 * nimmt diese Cloud den Ausschnitt an (`evidence`), auch nach einem 502: Die
 * Sichtung ist dann schon angelegt, der Hub legt den Ausschnitt in die
 * Historie (ohne Telegram – die Marke der Nachricht ist wieder frei).
 */
export function parkingReportReply<R extends { sightingId: number | null; undelivered?: true }>(
  result: R,
): { status: number; body: Record<string, unknown> } {
  const evidence = result.sightingId != null ? { evidence: true } : {};
  if (result.undelivered) return { status: 502, body: { ok: false, error: "Nachricht nicht zugestellt", ...result, ...evidence } };
  return { status: 200, body: { ok: true, ...result, ...evidence } };
}

/**
 * Camera.noParkNotifyKey hält den Schlüssel der zuletzt verschickten
 * Nachricht; ging zur ersten Nachricht der Ausschnitt an Telegram, trägt er
 * diese Endung. Ein „+“ kommt in Schlüsseln vom Hub nicht vor (KEY_RE).
 */
export const EVIDENCE_SENT_SUFFIX = "+e";

/** Marke: Zur Nachricht `notifyKey` ging der Ausschnitt an Telegram. */
export function evidenceSentKey(notifyKey: string): string {
  return `${notifyKey}${EVIDENCE_SENT_SUFFIX}`;
}

/**
 * Ging nachweislich nichts hinaus? Dann gibt die Cloud den beanspruchten
 * Schlüssel wieder frei, und der nächste Versuch des Hubs schickt die
 * Nachricht. Nachweislich heißt: kein Push zugestellt und keiner mit offenem
 * Ausgang (Netz, Zeitüberschreitung), Telegram hat jede Nachricht abgelehnt
 * oder es gibt kein Telegram, und es gab überhaupt etwas zu schicken.
 */
export function nothingDelivered(d: {
  /** Push-Abos und Telegram-Chats, an die geschickt werden sollte. */
  channels: number;
  pushSent: number;
  /** Push gescheitert ohne Antwort des Push-Dienstes, die das belegt. */
  pushUncertain: boolean;
  telegramSent: number;
  /** Telegram-Aufruf ohne Antwort (Netz, Zeitüberschreitung). */
  telegramUncertain: boolean;
}): boolean {
  return d.channels > 0 && d.pushSent === 0 && !d.pushUncertain && d.telegramSent === 0 && !d.telegramUncertain;
}

/** Hat der Hub selbst entschieden? Dann richtet sich die Cloud ganz nach ihm. */
export function hubDecides(p: HubParkingParams): boolean {
  return p.notify !== null || p.store !== null;
}

export interface ParkingDecision {
  store: boolean;
  notify: boolean;
  skipped?: "cooldown" | "duplicate";
}

/**
 * Historie und Benachrichtigung für eine Meldung.
 *
 * - Neuerer Hub: `store` und `notify` wie angegeben (fehlt eines, gilt 0).
 * - Älterer Hub: immer in die Historie; Nachricht nur, wenn weder der Merker
 *   im Speicher (COOLDOWN_MINUTES) noch die letzte Halteverbot-Sichtung der
 *   Kamera in der Datenbank (DB_COOLDOWN_MINUTES) jünger ist.
 */
export function decideParkingViolation(
  p: HubParkingParams,
  ctx: { now: number; lastNotifiedAt: number | null; lastSightingAt: number | null },
): ParkingDecision {
  if (hubDecides(p)) return { store: p.store === true, notify: p.notify === true };
  const recent = (at: number | null, minutes: number) => at != null && ctx.now - at < minutes * 60_000;
  if (recent(ctx.lastNotifiedAt, COOLDOWN_MINUTES) || recent(ctx.lastSightingAt, DB_COOLDOWN_MINUTES)) {
    return { store: true, notify: false, skipped: "cooldown" };
  }
  return { store: true, notify: true };
}

/** Wie weit zurück eine Sichtung mit demselben Schlüssel gesucht wird (der Hub versucht es höchstens rund 30 Minuten). */
export const REPORT_KEY_LOOKBACK_MINUTES = 120;
/**
 * Wie weit zurück der gespeicherte Eintrag zur ersten Nachricht gesucht wird
 * (evidenceKey): Ein Fahrzeug, das ab dem Abend steht, wird nachts
 * gespeichert und morgens gemeldet.
 */
export const EVIDENCE_KEY_LOOKBACK_MINUTES = 24 * 60;

export interface RepeatedReport {
  /** Sichtung mit demselben `storeKey` (ein früherer Versuch hat sie angelegt), sonst null. */
  existingSightingId: number | null;
  /** Die Nachricht mit demselben `notifyKey` ging schon hinaus. */
  notifySent: boolean;
}

/**
 * Wiederholter Versuch derselben Meldung (Antwort erreichte den Hub nicht):
 * keine zweite Sichtung – die vorhandene wird genannt – und keine zweite
 * Nachricht. Ohne Schlüssel (älterer Hub) bleibt die Entscheidung, wie sie ist.
 */
export function dedupeParkingReport(
  decision: ParkingDecision,
  repeated: RepeatedReport,
): { createSighting: boolean; sightingId: number | null; notify: boolean; skipped?: "cooldown" | "duplicate" } {
  const reuse = decision.store && repeated.existingSightingId != null;
  const notify = decision.notify && !repeated.notifySent;
  const skipped = decision.notify && repeated.notifySent ? "duplicate" : decision.skipped;
  return {
    createSighting: decision.store && !reuse,
    sightingId: reuse ? repeated.existingSightingId : null,
    notify,
    ...(skipped ? { skipped } : {}),
  };
}

export function standingLabel(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)} Sekunden`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} Minuten` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** Titel und Text für Push und Telegram. */
export function parkingMessage(input: {
  cameraName: string;
  vehicles: number;
  seconds: number;
  time: string;
  reminder: number | null;
}): { title: string; body: string } {
  const subject = input.vehicles === 1 ? "Ein Fahrzeug" : `${input.vehicles} Fahrzeuge`;
  const verb = input.reminder ? (input.vehicles === 1 ? "steht" : "stehen") + " noch" : null;
  const body = verb
    ? `${input.cameraName}: ${subject} ${verb}, seit ${standingLabel(input.seconds)} · ${input.time}`
    : `${input.cameraName}: ${subject} seit ${standingLabel(input.seconds)} · ${input.time}`;
  const title = input.reminder
    ? `Falschparker im Halteverbot – ${input.reminder}. Erinnerung`
    : "Falschparker im Halteverbot";
  return { title, body };
}

/**
 * Ausschnitt in voller Auflösung: Der Hub reicht ihn direkt nach der
 * zugestellten Meldung nach – auch nach Wiederholungen über rund 30 Minuten,
 * deren erster Versuch die Sichtung schon angelegt hatte. Später oder ein
 * zweites Mal wird er nicht angenommen.
 */
export const EVIDENCE_MAX_AGE_MINUTES = 60;
/** Wie das Übersichtsbild höchstens 4 MB. */
export const MAX_EVIDENCE_BYTES = 4 * 1024 * 1024;

export type EvidenceCheck = "ok" | "not_found" | "too_old" | "exists";

/** Darf der Ausschnitt an diese Sichtung? */
export function checkEvidenceTarget(
  sighting: { source: string; seenAt: Date; hasEvidence: boolean } | null,
  now: Date,
): EvidenceCheck {
  if (!sighting || sighting.source !== "NO_PARKING") return "not_found";
  if (sighting.hasEvidence) return "exists";
  const age = now.getTime() - sighting.seenAt.getTime();
  if (age > EVIDENCE_MAX_AGE_MINUTES * 60_000) return "too_old";
  return "ok";
}

/** Beschriftung des zweiten Bildes in Telegram (Text, ohne HTML). */
export function evidenceCaption(cameraName: string | null, time: string): string {
  return `Ausschnitt in voller Auflösung${cameraName ? ` · ${cameraName}` : ""} · ${time}`;
}
