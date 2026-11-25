import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";
import type { TenantDb } from "@/lib/prisma";
import { runMotionRules } from "@/lib/room-rules";
import { sendDoorbellPush } from "@/lib/doorbell-push";
import {
  ORPHAN_BATCH,
  eventKey,
  missingRunning,
  parseCloseOpen,
  parseRunning,
  planOrphanClose,
  staleOpen,
  type CloseOpenRequest,
  type RunningEvent,
} from "@/lib/camera-events";

const VALID_TYPES = ["MOTION", "PERSON", "VEHICLE", "ANIMAL", "DOORBELL", "OTHER"];
const MAX_EVENTS_PER_REQUEST = 100;

/**
 * Ereignisse schliessen, die der Hub nach seinem Neustart nicht mehr beenden
 * kann (sein Zustand lag nur im Speicher). Was mit welchem Ereignis geschieht,
 * entscheidet `planOrphanClose`.
 */
async function closeOrphans(
  db: TenantDb,
  accountId: number,
  req: CloseOpenRequest,
  lastSeenByCamera: Map<number, Date | null>,
): Promise<{ closed: number; more: boolean }> {
  const open = await db.cameraEvent.findMany({
    where: { accountId, cameraId: { in: req.cameraIds }, endedAt: null, startedAt: { lt: req.before } },
    select: { id: true, cameraId: true, type: true, startedAt: true },
    orderBy: { startedAt: "desc" },
    take: ORPHAN_BATCH + 1,
  });
  if (open.length === 0) return { closed: 0, more: false };
  const batch = open.slice(0, ORPHAN_BATCH);

  // Je Kamera und Art das juengste Ereignis vor dem Hub-Start: Nur das kann
  // noch gelaufen sein. Nacheinander, es sind selten mehr als eine Handvoll.
  const keys = new Map<string, { cameraId: number; type: string }>();
  for (const e of batch) keys.set(eventKey(e), { cameraId: e.cameraId, type: e.type });
  const newestIdByKey = new Map<string, number>();
  for (const [key, k] of keys) {
    const newest = await db.cameraEvent.findFirst({
      where: { accountId, cameraId: k.cameraId, type: k.type, startedAt: { lt: req.before } },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    if (newest) newestIdByKey.set(key, newest.id);
  }

  let closed = 0;
  for (const p of planOrphanClose(batch, newestIdByKey, req.before, lastSeenByCamera, req.lastAlive)) {
    // `endedAt: null` im Filter: ein inzwischen gemeldetes Ende bleibt stehen.
    const r = await db.cameraEvent.updateMany({
      where: { id: p.id, accountId, endedAt: null },
      data: { endedAt: p.endedAt },
    });
    closed += r.count;
  }
  return { closed, more: open.length > ORPHAN_BATCH };
}

/**
 * Nach einem neuen Beginn: aeltere offene Ereignisse derselben Kamera und Art
 * schliessen. Der Hub fuehrt je Kamera und Art nur ein Ereignis; ist ein
 * aelteres noch offen, kam sein Ende nie an (die Meldung der DoorBird wird
 * zum Beispiel nicht beliebig oft wiederholt) und es gaelte sonst weiter als
 * laufend.
 */
async function closeStaleOpen(
  db: TenantDb,
  accountId: number,
  started: Map<string, { cameraId: number; type: string }>,
): Promise<number> {
  if (started.size === 0) return 0;
  const open = await db.cameraEvent.findMany({
    where: { accountId, endedAt: null, OR: [...started.values()] },
    select: { id: true, cameraId: true, type: true, startedAt: true },
  });
  let closed = 0;
  for (const e of staleOpen(open)) {
    const r = await db.cameraEvent.updateMany({
      where: { id: e.id, accountId, endedAt: null },
      data: { endedAt: e.startedAt },
    });
    closed += r.count;
  }
  return closed;
}

/**
 * Laufende Ereignisse des Hubs nachtragen, die die Cloud nicht kennt (ihr
 * Beginn kam nie an). Ohne Regeln und ohne Push: Der Beginn liegt zurueck.
 */
async function addMissingRunning(db: TenantDb, accountId: number, running: RunningEvent[]): Promise<number> {
  if (running.length === 0) return 0;
  const open = await db.cameraEvent.findMany({
    where: { accountId, cameraId: { in: [...new Set(running.map((r) => r.cameraId))] }, endedAt: null },
    select: { cameraId: true, type: true },
  });
  let created = 0;
  for (const r of missingRunning(running, new Set(open.map(eventKey)))) {
    await db.cameraEvent.create({
      data: { cameraId: r.cameraId, type: r.type, startedAt: r.startedAt, accountId },
    });
    created++;
  }
  return created;
}

/**
 * POST (Hub, Token-Auth): Bewegungs-/KI-Ereignisse melden.
 * Body: { events: [{ cameraId, type, phase: "start"|"end", at }] }
 * - start: legt ein neues offenes Ereignis an; aeltere offene derselben
 *          Kamera und Art enden dabei (ihr Ende kam nie an)
 * - end:   schliesst das juengste offene Ereignis dieses Typs, das nicht
 *          nach diesem Ende begann
 * Zusaetzlich:
 * - { seen: [cameraId] } aktualisiert lastSeenAt der Kameras, die beim
 *   Polling erreichbar waren.
 * - { closeOpen: { cameraIds, before, lastAlive? } } nach einem Hub-Start:
 *   schliesst die Ereignisse dieser Kameras, die vor `before` begannen und
 *   offen blieben.
 * - { running: [{ cameraId, type, at }] } nennt, was am Hub gerade laeuft
 *   (Stand nach den Ereignissen dieser Meldung); Fehlendes wird nachgetragen.
 */
export async function POST(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const { db, account } = auth;

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Ungültiger Body" }, { status: 400 });

  const now = new Date();
  const events = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS_PER_REQUEST) : [];
  const closeOpen = parseCloseOpen(body.closeOpen, now);
  const running = parseRunning(body.running, now, VALID_TYPES);

  // Kameras einmal je Meldung laden statt einmal je Ereignis. Vor dem
  // seen-Update: closeOpen braucht den Stand von vor dieser Meldung.
  const cameras =
    events.length > 0 || closeOpen || (running && running.length > 0)
      ? await db.camera.findMany({
          where: { accountId: account.id },
          select: { id: true, name: true, kind: true, lastSeenAt: true },
        })
      : [];
  const cameraById = new Map(cameras.map((c) => [c.id, c]));

  let orphans: { closed: number; more: boolean } | null = null;
  if (closeOpen) {
    try {
      orphans = await closeOrphans(
        db,
        account.id,
        closeOpen,
        new Map(cameras.map((c) => [c.id, c.lastSeenAt])),
      );
    } catch (err) {
      // Aufraeumen darf die Meldung der neuen Ereignisse nicht verhindern;
      // der Hub versucht es mit der naechsten Meldung noch einmal.
      console.error("[camera-events] closeOpen failed:", err);
      orphans = { closed: 0, more: true };
    }
  }

  // Erreichbarkeit der Kameras aktualisieren.
  const seen = Array.isArray(body.seen)
    ? body.seen.map(Number).filter(Number.isInteger)
    : [];
  if (seen.length > 0) {
    await db.camera.updateMany({
      where: { id: { in: seen }, accountId: account.id },
      data: { lastSeenAt: now },
    });
  }

  let created = 0;
  let closed = 0;
  let rulesTriggered = 0;
  let pushed = 0;
  /** Kamera und Art mit einem Beginn in dieser Meldung. */
  const started = new Map<string, { cameraId: number; type: string }>();

  for (const e of events) {
    const cameraId = Number(e?.cameraId);
    const type = String(e?.type ?? "");
    const phase = String(e?.phase ?? "");
    const at = e?.at ? new Date(e.at) : now;
    if (!Number.isInteger(cameraId) || !VALID_TYPES.includes(type) || isNaN(at.getTime())) continue;

    const camera = cameraById.get(cameraId);
    if (!camera) continue;

    if (phase === "start") {
      await db.cameraEvent.create({
        data: { cameraId, type, startedAt: at, accountId: account.id },
      });
      created++;
      started.set(eventKey({ cameraId, type }), { cameraId, type });
      // Klingel an der DoorBird: sofort Push an die PWA (vor allem anderen,
      // der Schnappschuss kommt separat ueber /snapshot).
      if (type === "DOORBELL" && camera.kind === "DOORBIRD") {
        pushed += await sendDoorbellPush(account.id, camera, at);
      }
      // Raumregeln mit Bewegungs-Trigger: abwarten (serverless beendet
      // offene Promises nach der Antwort), Fehler blockieren den Ingest nicht.
      // Der Hub holt danach sofort seine Tasks ab (z. B. Kamera steuern).
      try {
        rulesTriggered += (await runMotionRules(account.id, cameraId, type, at)).triggered;
      } catch (err) {
        console.error("[camera-events] room rules failed:", err);
      }

      // Ueberwachungs-Push nicht auf den rohen KI-Alarm der Kamera: der
      // flackert und meldet geparkte Autos/Strasse. PERSON pusht erst nach
      // dem Face-Match (person-sightings), VEHICLE erst nach der Pruefung
      // auf dem Hub (vehicle-sightings: Kennzeichen oder Fahrzeug im Bild).
      // PERSON-/VEHICLE-Sichtungen inkl. Schnappschuss laufen ueber
      // POST /api/hub/person-sightings bzw. /api/hub/vehicle-sightings.
    } else if (phase === "end") {
      // Nie ein Ereignis schliessen, das erst nach diesem Ende begann: Ein
      // Ende kann verspaetet eintreffen, wenn der Hub es wiederholen musste.
      const open = await db.cameraEvent.findFirst({
        where: { cameraId, type, endedAt: null, accountId: account.id, startedAt: { lte: at } },
        orderBy: { startedAt: "desc" },
      });
      if (open) {
        await db.cameraEvent.update({ where: { id: open.id }, data: { endedAt: at } });
        closed++;
      }
    }
  }

  // Altlasten hinter einem neuen Beginn schliessen. Scheitert das, bleibt
  // es fuer die naechste Meldung mit einem Beginn; die Ereignisse stehen.
  let staleClosed = 0;
  try {
    staleClosed = await closeStaleOpen(db, account.id, started);
  } catch (err) {
    console.error("[camera-events] stale open failed:", err);
  }

  // Nach den Ereignissen dieser Meldung: Was am Hub laeuft und hier fehlt.
  // Die Angabe ohne Zahl in der Antwort heisst fuer den Hub „nicht
  // abgeglichen“; er schickt die Liste mit der naechsten Minute wieder.
  let runningCreated: number | null = null;
  if (running) {
    try {
      runningCreated = await addMissingRunning(
        db,
        account.id,
        running.filter((r) => cameraById.has(r.cameraId)),
      );
    } catch (err) {
      console.error("[camera-events] running failed:", err);
    }
  }

  return NextResponse.json({
    ok: true,
    created,
    closed,
    rulesTriggered,
    pushed,
    ...(staleClosed > 0 ? { staleClosed } : {}),
    ...(orphans ? { orphansClosed: orphans.closed, orphansMore: orphans.more } : {}),
    ...(runningCreated !== null ? { runningCreated } : {}),
  });
}
