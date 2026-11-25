/**
 * Reine Regeln rund um Kamera-Ereignisse (ohne Datenbank, testbar).
 */

/** Laenger als das gilt ein offenes Ereignis nicht mehr als laufend. */
export const OPEN_EVENT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Der Hub meldet erreichbare Kameras einmal je Minute (`seen`). */
export const SEEN_REPORT_SLACK_MS = 60_000;
/** So viele offene Ereignisse schliesst eine Meldung hoechstens. */
export const ORPHAN_BATCH = 200;
/**
 * So lange nach der letzten Meldung ihrer Kamera gilt ein offenes Ereignis
 * noch als laufend (Reolink meldet der Hub jede Minute, DoorBird alle zwei).
 */
export const OPEN_EVENT_FRESH_MS = 5 * 60_000;
/** So viele laufende Ereignisse nimmt eine Meldung hoechstens an. */
export const RUNNING_MAX = 200;

export interface CloseOpenRequest {
  cameraIds: number[];
  before: Date;
  /** Letztes Lebenszeichen des alten Hub-Prozesses (vom Hub notiert), falls bekannt. */
  lastAlive: Date | null;
}

/**
 * Meldung des Hubs nach seinem Start: Seine offenen Ereignisse von vorher
 * kann er nicht mehr beenden (der Zustand lag nur im Speicher). Liest die
 * Angabe streng: nur ganze Kamera-IDs, hoechstens 200, Zeitpunkt nicht in
 * der Zukunft (eine Minute Uhrenabweichung erlaubt).
 */
export function parseCloseOpen(raw: unknown, now: Date): CloseOpenRequest | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as { cameraIds?: unknown; before?: unknown; lastAlive?: unknown };
  if (!Array.isArray(r.cameraIds) || typeof r.before !== "string") return null;
  const cameraIds = [...new Set(r.cameraIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 200);
  const before = new Date(r.before);
  if (cameraIds.length === 0 || isNaN(before.getTime())) return null;
  if (before.getTime() > now.getTime() + 60_000) return null;
  // Das Lebenszeichen stammt vom alten Prozess: nie nach dem Start des neuen.
  const alive = typeof r.lastAlive === "string" ? new Date(r.lastAlive) : null;
  const lastAlive = alive && !isNaN(alive.getTime()) && alive.getTime() <= before.getTime() ? alive : null;
  return { cameraIds, before, lastAlive };
}

export interface OpenEvent {
  id: number;
  cameraId: number;
  type: string;
  startedAt: Date;
}

/** Je Kamera und Art fuehrt der Hub hoechstens ein laufendes Ereignis. */
export function eventKey(e: { cameraId: number; type: string }): string {
  return `${e.cameraId}:${e.type}`;
}

/**
 * Ende fuer das Ereignis, das lief, als der alte Hub-Prozess endete: der
 * letzte Zeitpunkt, zu dem der Hub die Kamera noch als erreichbar gemeldet
 * hat (plus Meldetakt), nie nach dem Neustart und nie vor dem Beginn. Stand
 * der Hub Stunden still (Stromausfall), endet das Ereignis also beim Ausfall
 * und nicht erst beim Wiederanlauf. Ohne Angabe gilt der Neustart.
 */
export function orphanEndedAt(startedAt: Date, before: Date, lastSeenAt: Date | null): Date {
  const start = startedAt.getTime();
  const limit = Math.max(start, before.getTime());
  if (!lastSeenAt) return new Date(limit);
  return new Date(Math.min(limit, Math.max(start, lastSeenAt.getTime() + SEEN_REPORT_SLACK_MS)));
}

/**
 * Wann der alte Hub-Prozess eine Kamera zuletzt sicher im Blick hatte. Die
 * Meldung der Kamera (`lastSeenAt`) zaehlt nur, wenn sie von vor dem Start
 * stammt: Der neue Prozess schreibt das Feld auf mehreren Wegen (Bilder,
 * Tor, Klingel) oft schon, bevor er das Aufraeumen meldet. Dann gilt das
 * Lebenszeichen, das der alte Prozess selbst notiert hat. Sind beide da,
 * zaehlt das fruehere: Fiel die Kamera vor dem Hub aus, endete ihr Ereignis
 * dort.
 */
export function lastKnownAlive(before: Date, lastSeenAt: Date | null, lastAlive: Date | null): Date | null {
  const seen = lastSeenAt && lastSeenAt.getTime() < before.getTime() ? lastSeenAt : null;
  if (seen && lastAlive) return seen.getTime() <= lastAlive.getTime() ? seen : lastAlive;
  return seen ?? lastAlive;
}

/**
 * Was mit den offenen Ereignissen von vor dem Hub-Start geschieht. Je Kamera
 * und Art kann nur das juengste Ereignis noch gelaufen sein, als der alte
 * Prozess endete. Alle aelteren sind Altlasten, deren Ende verloren ging:
 * Niemand kennt es, sie enden an ihrem Beginn, statt tagelang als
 * Dauer-Ereignis zu zaehlen. `newestIdByKey` nennt je Kamera und Art das
 * juengste Ereignis vor dem Start (offen oder beendet).
 */
export function planOrphanClose(
  open: OpenEvent[],
  newestIdByKey: Map<string, number>,
  before: Date,
  lastSeenByCamera: Map<number, Date | null>,
  lastAlive: Date | null = null,
): Array<{ id: number; endedAt: Date }> {
  return open.map((e) => ({
    id: e.id,
    endedAt:
      newestIdByKey.get(eventKey(e)) === e.id
        ? orphanEndedAt(
            e.startedAt,
            before,
            lastKnownAlive(before, lastSeenByCamera.get(e.cameraId) ?? null, lastAlive),
          )
        : e.startedAt,
  }));
}

/**
 * Offene Ereignisse, die nicht mehr laufen koennen: Der Hub fuehrt je Kamera
 * und Art nur eines. Stehen mehrere offen, lief hoechstens das juengste noch;
 * bei den aelteren kam das Ende nie an. Sie enden wie die Altlasten nach
 * einem Hub-Start an ihrem Beginn (das wahre Ende kennt niemand).
 */
export function staleOpen(open: OpenEvent[]): OpenEvent[] {
  const newest = new Map<string, OpenEvent>();
  for (const e of open) {
    const cur = newest.get(eventKey(e));
    const later =
      !cur ||
      e.startedAt.getTime() > cur.startedAt.getTime() ||
      (e.startedAt.getTime() === cur.startedAt.getTime() && e.id > cur.id);
    if (later) newest.set(eventKey(e), e);
  }
  return open.filter((e) => newest.get(eventKey(e)) !== e);
}

export interface RunningEvent {
  cameraId: number;
  type: string;
  startedAt: Date;
}

/**
 * Liste der Ereignisse, die am Hub gerade laufen (einmal je Minute, zusammen
 * mit `seen`). Kommt der Beginn eines Ereignisses nie in der Cloud an, weil
 * die Meldung scheiterte, traegt die Cloud es anhand dieser Liste nach. `null`
 * heisst: keine Angabe (aelterer Hub). Liest streng: ganze Kamera-ID,
 * bekannte Art, Beginn weder in der Zukunft noch aelter als ein Tag, je
 * Kamera und Art ein Eintrag.
 */
export function parseRunning(raw: unknown, now: Date, validTypes: readonly string[]): RunningEvent[] | null {
  if (!Array.isArray(raw)) return null;
  const out: RunningEvent[] = [];
  const seen = new Set<string>();
  for (const r of raw.slice(0, RUNNING_MAX) as Array<{ cameraId?: unknown; type?: unknown; at?: unknown } | null>) {
    if (!r || typeof r !== "object") continue;
    const cameraId = Number(r.cameraId);
    const type = typeof r.type === "string" ? r.type : "";
    const startedAt = typeof r.at === "string" ? new Date(r.at) : null;
    if (!Number.isInteger(cameraId) || cameraId <= 0 || !validTypes.includes(type)) continue;
    if (!startedAt || isNaN(startedAt.getTime())) continue;
    const age = now.getTime() - startedAt.getTime();
    if (age < -60_000 || age > OPEN_EVENT_MAX_AGE_MS) continue;
    const key = eventKey({ cameraId, type });
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ cameraId, type, startedAt });
  }
  return out;
}

/**
 * Laufende Ereignisse des Hubs, zu denen die Cloud kein offenes Ereignis
 * derselben Kamera und Art hat: Nur diese werden nachgetragen.
 */
export function missingRunning(running: RunningEvent[], openKeys: Set<string>): RunningEvent[] {
  return running.filter((r) => !openKeys.has(eventKey(r)));
}

/**
 * Laeuft das Ereignis noch? Offen, hoechstens einen Tag alt, und der Hub hat
 * die Kamera in den letzten Minuten gemeldet. Ohne frische Meldung weiss
 * niemand, was vor der Kamera geschieht: Das offene Ereignis zaehlt dann
 * nicht mehr als laufend.
 */
export function isRunning(
  e: { startedAt: Date; endedAt: Date | null },
  cameraLastSeenAt: Date | null,
  now: Date,
): boolean {
  if (e.endedAt) return false;
  if (now.getTime() - e.startedAt.getTime() > OPEN_EVENT_MAX_AGE_MS) return false;
  return cameraLastSeenAt !== null && now.getTime() - cameraLastSeenAt.getTime() <= OPEN_EVENT_FRESH_MS;
}

/**
 * Zeitpunkt der letzten Aktivitaet: laufend = jetzt, beendet = das Ende. Ein
 * offenes Ereignis, dessen Kamera der Hub nicht mehr meldet, lief nachweislich
 * bis zu deren letzter Meldung (nie vor seinem Beginn). Es zaehlt dabei nur
 * den einen Tag, den es als laufend gelten kann: Ein aelteres offenes Ereignis
 * laeuft nicht mehr, auch wenn sich seine Kamera weiter meldet, und seine
 * letzte Aktivitaet rueckt deshalb nicht mit jeder Meldung weiter.
 */
export function activityAt(
  e: { startedAt: Date; endedAt: Date | null },
  cameraLastSeenAt: Date | null,
  now: Date,
): Date {
  if (e.endedAt) return e.endedAt;
  if (isRunning(e, cameraLastSeenAt, now)) return now;
  const seen = cameraLastSeenAt
    ? Math.min(cameraLastSeenAt.getTime(), now.getTime(), e.startedAt.getTime() + OPEN_EVENT_MAX_AGE_MS)
    : 0;
  return new Date(Math.max(e.startedAt.getTime(), seen));
}

/**
 * Ende, wie es eine Anzeige ausgibt: `null` nur, solange das Ereignis laeuft.
 * Ein offenes Ereignis, dessen Kamera der Hub nicht mehr meldet, endet fuer
 * die Anzeige mit seiner letzten Aktivitaet. Wer nur auf das fehlende Ende
 * schaut, zeigte es sonst weiter als laufend.
 */
export function shownEndedAt(
  e: { startedAt: Date; endedAt: Date | null },
  cameraLastSeenAt: Date | null,
  now: Date,
): Date | null {
  return isRunning(e, cameraLastSeenAt, now) ? null : activityAt(e, cameraLastSeenAt, now);
}

/**
 * Suchbedingung „seit `since` war etwas los“. Zaehlt auch ein Ereignis, das
 * frueher begann, aber noch laeuft oder erst danach endete: Bei anhaltender
 * Bewegung meldet die Kamera ein einziges langes Ereignis, und nur nach dem
 * Beginn zu schauen hielt den Raum faelschlich fuer ruhig. Auf die letzten
 * 24 Stunden begrenzt, damit der Index auf `startedAt` greift und ein nie
 * beendetes Altereignis nicht fuer immer als laufend gilt. Ein offenes
 * Ereignis zaehlt ausserdem nur bis zur letzten Meldung seiner Kamera: Faellt
 * die Kamera oder der Hub mitten im Ereignis aus, kommt dessen Ende erst viel
 * spaeter, und der Raum gaelte so lange als belebt. Die Grenze ist `since`,
 * mindestens aber `OPEN_EVENT_FRESH_MS` zurueck: Der Hub meldet eine Kamera
 * nur einmal je Minute (DoorBird alle zwei), ein laufendes Ereignis darf bei
 * sehr kurzem Zeitraum deshalb nicht herausfallen.
 */
export function recentActivityWhere(since: Date, now: Date) {
  const dayAgo = new Date(now.getTime() - OPEN_EVENT_MAX_AGE_MS);
  const from = since.getTime() < dayAgo.getTime() ? since : dayAgo;
  const seenFrom = new Date(Math.min(since.getTime(), now.getTime() - OPEN_EVENT_FRESH_MS));
  return {
    startedAt: { gte: from },
    OR: [
      { startedAt: { gte: since } },
      { endedAt: { gte: since } },
      { endedAt: null, camera: { lastSeenAt: { gte: seenFrom } } },
    ],
  };
}

/**
 * Liste fuer eine Auskunft: die juengsten Ereignisse eines Zeitraums, dazu
 * die noch offenen. Die juengsten kommen nach Beginn sortiert und begrenzt
 * aus der Datenbank. Ein Ereignis, das frueh begann und noch laeuft, stuende
 * an einem vollen Tag hinter dieser Grenze. Offene Ereignisse behalten
 * deshalb ihren Platz, dafuer weichen die aeltesten uebrigen. `open` darf
 * Ereignisse aus `recent` wiederholen. Das Ergebnis nennt jedes einmal, nach
 * Beginn absteigend, hoechstens `limit`.
 */
export function withOpenEvents<T extends { id: number; startedAt: Date }>(recent: T[], open: T[], limit: number): T[] {
  const seen = new Set<number>();
  const out: T[] = [];
  const add = (list: T[]) => {
    for (const e of list) {
      if (out.length >= limit) return;
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      out.push(e);
    }
  };
  add(open);
  add(recent);
  return out.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime() || b.id - a.id);
}

export interface RoomEventInput {
  roomId: number;
  cameraId: number;
  cameraName: string;
  type: string;
  startedAt: Date;
  endedAt: Date | null;
  cameraLastSeenAt: Date | null;
}

export interface RoomLastEvent {
  cameraId: number;
  cameraName: string;
  type: string;
  startedAt: string;
  /** Letzte Aktivitaet (`activityAt`): laufend der Abrufzeitpunkt, sonst das Ende oder die letzte Meldung der Kamera. */
  at: string;
  running: boolean;
}

/**
 * Je Raum das Ereignis mit der juengsten Aktivitaet. Ein laufendes Ereignis
 * geht vor, auch wenn es vor Stunden begann; unter mehreren laufenden das
 * zuletzt begonnene. Dasselbe Ereignis darf doppelt in der Eingabe stehen.
 */
export function latestActivityByRoom(events: RoomEventInput[], now: Date): Map<number, RoomLastEvent> {
  const best = new Map<number, { e: RoomEventInput; at: number; running: boolean }>();
  for (const e of events) {
    const running = isRunning(e, e.cameraLastSeenAt, now);
    const at = activityAt(e, e.cameraLastSeenAt, now).getTime();
    const cur = best.get(e.roomId);
    if (cur && (cur.at > at || (cur.at === at && cur.e.startedAt.getTime() >= e.startedAt.getTime()))) continue;
    best.set(e.roomId, { e, at, running });
  }
  const out = new Map<number, RoomLastEvent>();
  for (const [roomId, b] of best) {
    out.set(roomId, {
      cameraId: b.e.cameraId,
      cameraName: b.e.cameraName,
      type: b.e.type,
      startedAt: b.e.startedAt.toISOString(),
      at: new Date(b.at).toISOString(),
      running: b.running,
    });
  }
  return out;
}

/** Kamera-Ereignis, wie es die Raeume-Seite abfragt. */
export interface CameraEventRow {
  cameraId: number;
  type: string;
  startedAt: Date;
  endedAt: Date | null;
}

/** Je Kamera und Art der spaeteste Beginn und das spaeteste Ende unter den beendeten Ereignissen (`groupBy`). */
export interface LastEndedGroup {
  cameraId: number;
  type: string;
  _max: { startedAt: Date | null; endedAt: Date | null };
}

/**
 * Eingabe fuer `latestActivityByRoom` aus den drei Abfragen der Raeume-Seite:
 * je Kamera das zuletzt begonnene Ereignis, die offenen und je Kamera und Art
 * das zuletzt beendete. Keine der Listen reicht allein: Ein langes Ereignis
 * kann vor einem kuerzeren derselben Kamera begonnen haben. Laeuft es noch,
 * steht es nur unter den offenen; endete es nach dem kuerzeren, nur in der
 * Zeile je Kamera und Art. Der Hub fuehrt je Kamera und Art hoechstens ein
 * laufendes Ereignis, die Ereignisse einer Kamera und Art folgen also
 * aufeinander: Unter den beendeten gehoeren der spaeteste Beginn und das
 * spaeteste Ende deshalb zum selben Ereignis. Raum, Name und letzte Meldung
 * kommen von den Kameras der Raeume; das Ereignis einer Kamera ohne Raum
 * entfaellt.
 */
export function roomEventInputs(
  lists: { lastStarted: CameraEventRow[]; open: CameraEventRow[]; lastEnded: LastEndedGroup[] },
  rooms: Array<{ id: number; cameras: Array<{ id: number; name: string; lastSeenAt: Date | null }> }>,
): RoomEventInput[] {
  const lastEnded = lists.lastEnded.flatMap((g) =>
    g._max.startedAt && g._max.endedAt
      ? [{ cameraId: g.cameraId, type: g.type, startedAt: g._max.startedAt, endedAt: g._max.endedAt }]
      : [],
  );
  const roomCameras = new Map(
    rooms.flatMap((room) => room.cameras.map((camera) => [camera.id, { roomId: room.id, camera }] as const)),
  );
  return [...lists.lastStarted, ...lists.open, ...lastEnded].flatMap((e) => {
    const hit = roomCameras.get(e.cameraId);
    if (!hit) return [];
    return [
      {
        roomId: hit.roomId,
        cameraId: e.cameraId,
        cameraName: hit.camera.name,
        type: e.type,
        startedAt: e.startedAt,
        endedAt: e.endedAt,
        cameraLastSeenAt: hit.camera.lastSeenAt,
      },
    ];
  });
}

/** So lange nach dem Abruf zeigt eine geoeffnete Seite ein laufendes Ereignis noch als laufend. */
export const RUNNING_SHOWN_MS = 2 * 60_000;

/**
 * Zeigt eine geoeffnete Seite das Ereignis noch als laufend? `running` ist der
 * Stand beim Abruf, `at` bei einem laufenden Ereignis dessen Zeitpunkt. Liegt
 * der Abruf laenger zurueck, weiss die Seite nicht mehr, ob das Ereignis noch
 * laeuft: Sie nennt dann wie bei einem beendeten das Alter der Angabe, statt
 * ueber Stunden „laeuft“ zu zeigen. Das Alter misst die Uhr des Browsers
 * gegen den Zeitpunkt des Servers, wie bei den uebrigen Zeitangaben der
 * Seite: Geht sie nach, zaehlt der Abruf als eben geschehen; geht sie um die
 * Frist oder mehr vor, gilt die Angabe von Anfang an als gealtert.
 */
export function shownAsRunning(e: Pick<RoomLastEvent, "at" | "running">, nowMs: number): boolean {
  return e.running && nowMs - Date.parse(e.at) < RUNNING_SHOWN_MS;
}
