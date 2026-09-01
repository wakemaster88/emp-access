import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";
import { runMotionRules } from "@/lib/room-rules";
import { maybeSurveillanceAlert } from "@/lib/surveillance";

const VALID_TYPES = ["MOTION", "PERSON", "VEHICLE", "ANIMAL", "DOORBELL", "OTHER"];
const MAX_EVENTS_PER_REQUEST = 100;

/**
 * POST (Hub, Token-Auth): Bewegungs-/KI-Ereignisse melden.
 * Body: { events: [{ cameraId, type, phase: "start"|"end", at }] }
 * - start: legt ein neues offenes Ereignis an
 * - end:   schliesst das juengste offene Ereignis dieses Typs
 * Zusaetzlich: { seen: [cameraId] } aktualisiert lastSeenAt der Kameras,
 * die beim Polling erreichbar waren.
 */
export async function POST(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const { db, account } = auth;

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Ungültiger Body" }, { status: 400 });

  const now = new Date();

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

  const events = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS_PER_REQUEST) : [];
  let created = 0;
  let closed = 0;

  for (const e of events) {
    const cameraId = Number(e?.cameraId);
    const type = String(e?.type ?? "");
    const phase = String(e?.phase ?? "");
    const at = e?.at ? new Date(e.at) : now;
    if (!Number.isInteger(cameraId) || !VALID_TYPES.includes(type) || isNaN(at.getTime())) continue;

    const camera = await db.camera.findFirst({
      where: { id: cameraId, accountId: account.id },
      select: { id: true, name: true },
    });
    if (!camera) continue;

    if (phase === "start") {
      await db.cameraEvent.create({
        data: { cameraId, type, startedAt: at, accountId: account.id },
      });
      created++;
      // Raumregeln mit Bewegungs-Trigger asynchron ausloesen
      // (Fehler duerfen den Event-Ingest nicht blockieren).
      runMotionRules(account.id, cameraId, type, at).catch((err) => {
        console.error("[camera-events] room rules failed:", err);
      });

      if (type === "VEHICLE") {
        maybeSurveillanceAlert({
          accountId: account.id,
          cameraId,
          type,
          cameraName: camera.name,
          at,
        }).catch((err) => {
          console.error("[camera-events] surveillance failed:", err);
        });
      }
      // PERSON: Push/Telegram erst nach Face-Match in person-sightings,
      // damit Whitelist-Personen keine Überwachungs-Alarm auslösen.

      // PERSON-/VEHICLE-Sichtungen inkl. Schnappschuss laufen ueber
      // POST /api/hub/person-sightings bzw. /api/hub/vehicle-sightings.
    } else if (phase === "end") {
      const open = await db.cameraEvent.findFirst({
        where: { cameraId, type, endedAt: null, accountId: account.id },
        orderBy: { startedAt: "desc" },
      });
      if (open) {
        await db.cameraEvent.update({ where: { id: open.id }, data: { endedAt: at } });
        closed++;
      }
    }
  }

  return NextResponse.json({ ok: true, created, closed });
}
