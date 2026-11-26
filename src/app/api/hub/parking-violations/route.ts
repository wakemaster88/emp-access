import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-token-auth";
import { processParkingViolation } from "@/lib/parking-violations";
import {
  cameraUpdateForReport,
  parkingReportReply,
  parseHubParkingParams,
  repeatsFirstImage,
} from "@/lib/parking-violations-rules";

const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;

/**
 * POST (Hub): Fahrzeug steht zu lange in einer gesperrten Fläche.
 * Query: cameraId, vehicles, seconds
 *   ab neuerem Hub zusätzlich: notify (0|1), store (0|1), inZone, reminder –
 *   dann entscheidet der Hub über Historie und Nachricht; ohne diese Angaben
 *   gilt die Sperre für ältere Hubs (parking-violations-rules.ts).
 *   storeKey, notifyKey: gleich bei jedem Versuch derselben Meldung; ein
 *   wiederholter Versuch legt keine zweite Sichtung an und schickt keine
 *   zweite Nachricht. Ging nachweislich nichts hinaus, antwortet die Route
 *   mit 502, und der nächste Versuch schickt die Nachricht.
 *   evidenceKey: erste Nachricht ohne neuen Eintrag – der Ausschnitt des
 *   gespeicherten Eintrags mit diesem Schlüssel geht mit an Telegram, genau
 *   einmal je Nachricht (Antwort: evidenceTelegram).
 *   retry=1: Das Bild ist das des ersten Versuchs – es wird nicht als
 *   aktuelles Kamerabild gesetzt.
 *   Alle Angaben sind optional; ältere Hubs schicken sie nicht.
 * Antwort mit Sichtung: evidence: true (Ausschnitt über /evidence), auch beim 502.
 * Body: rohes JPEG
 */
export async function POST(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const { db, account } = auth;

  const q = request.nextUrl.searchParams;
  const cameraId = Number(q.get("cameraId"));
  if (!Number.isInteger(cameraId)) {
    return NextResponse.json({ error: "cameraId fehlt" }, { status: 400 });
  }
  const vehicles = Math.max(1, Number(q.get("vehicles")) || 1);
  const seconds = Math.max(0, Number(q.get("seconds")) || 0);

  const camera = await db.camera.findFirst({
    where: { id: cameraId, accountId: account.id },
    select: { id: true, name: true },
  });
  if (!camera) return NextResponse.json({ error: "Kamera nicht gefunden" }, { status: 404 });

  const buf = Buffer.from(await request.arrayBuffer());
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    return NextResponse.json({ error: "Kein gültiges JPEG" }, { status: 400 });
  }
  if (buf.length > MAX_SNAPSHOT_BYTES) {
    return NextResponse.json({ error: "Schnappschuss zu groß" }, { status: 413 });
  }

  const now = new Date();
  // select {id}: sonst gibt RETURNING die JPEG-Bytes wieder mit zurück.
  await db.camera.update({
    where: { id: cameraId },
    data: cameraUpdateForReport(buf, now, repeatsFirstImage(q)),
    select: { id: true },
  });

  const result = await processParkingViolation({
    accountId: account.id,
    cameraId,
    cameraName: camera.name,
    vehicles,
    seconds,
    snapshot: buf,
    at: now,
    params: parseHubParkingParams(q),
  });

  // evidence: Diese Cloud nimmt den Ausschnitt zur Sichtung an (/evidence), auch nach einem 502.
  const reply = parkingReportReply(result);
  return NextResponse.json(reply.body, { status: reply.status });
}
