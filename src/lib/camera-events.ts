/**
 * Reine Regeln rund um Kamera-Ereignisse (ohne Datenbank, testbar).
 */

/** Laenger als das gilt ein offenes Ereignis nicht mehr als laufend. */
export const OPEN_EVENT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Der Hub meldet erreichbare Kameras einmal je Minute (`seen`). */
export const SEEN_REPORT_SLACK_MS = 60_000;
/** So viele offene Ereignisse schliesst eine Meldung hoechstens. */
export const ORPHAN_BATCH = 200;

export interface CloseOpenRequest {
  cameraIds: number[];
  before: Date;
}

/**
 * Meldung des Hubs nach seinem Start: Seine offenen Ereignisse von vorher
 * kann er nicht mehr beenden (der Zustand lag nur im Speicher). Liest die
 * Angabe streng: nur ganze Kamera-IDs, hoechstens 200, Zeitpunkt nicht in
 * der Zukunft (eine Minute Uhrenabweichung erlaubt).
 */
export function parseCloseOpen(raw: unknown, now: Date): CloseOpenRequest | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as { cameraIds?: unknown; before?: unknown };
  if (!Array.isArray(r.cameraIds) || typeof r.before !== "string") return null;
  const cameraIds = [...new Set(r.cameraIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 200);
  const before = new Date(r.before);
  if (cameraIds.length === 0 || isNaN(before.getTime())) return null;
  if (before.getTime() > now.getTime() + 60_000) return null;
  return { cameraIds, before };
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
): Array<{ id: number; endedAt: Date }> {
  return open.map((e) => ({
    id: e.id,
    endedAt:
      newestIdByKey.get(eventKey(e)) === e.id
        ? orphanEndedAt(e.startedAt, before, lastSeenByCamera.get(e.cameraId) ?? null)
        : e.startedAt,
  }));
}

/**
 * Suchbedingung „seit `since` war etwas los“. Zaehlt auch ein Ereignis, das
 * frueher begann, aber noch laeuft oder erst danach endete: Bei anhaltender
 * Bewegung meldet die Kamera ein einziges langes Ereignis, und nur nach dem
 * Beginn zu schauen hielt den Raum faelschlich fuer ruhig. Auf die letzten
 * 24 Stunden begrenzt, damit der Index auf `startedAt` greift und ein nie
 * beendetes Altereignis nicht fuer immer als laufend gilt.
 */
export function recentActivityWhere(since: Date, now: Date) {
  const dayAgo = new Date(now.getTime() - OPEN_EVENT_MAX_AGE_MS);
  const from = since.getTime() < dayAgo.getTime() ? since : dayAgo;
  return {
    startedAt: { gte: from },
    OR: [{ startedAt: { gte: since } }, { endedAt: { gte: since } }, { endedAt: null }],
  };
}
