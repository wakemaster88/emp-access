import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";
import { runMotionRules } from "@/lib/room-rules";

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
  let rulesTriggered = 0;

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

  return NextResponse.json({ ok: true, created, closed, rulesTriggered });
}
