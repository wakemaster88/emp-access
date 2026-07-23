import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";

const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;

/**
 * Zeitfenster fuer die Scan-Zuordnung: Der Task wird beim Scan angelegt
 * (`at` = Scan-Zeitpunkt); der zugehoerige Scan-Datensatz entsteht wenige
 * Millisekunden danach. Wir suchen den zeitlich naechsten Scan des Geraets
 * in [at - 10 s, at + 60 s].
 */
const MATCH_BEFORE_MS = 10_000;
const MATCH_AFTER_MS = 60_000;

/**
 * POST (Hub, Token-Auth): Kamerabild zum Scan-Zeitpunkt (Task SCAN_SNAPSHOT).
 * Query: ?cameraId=..&deviceId=..&at=ISO – Body: rohes JPEG.
 * Ordnet das Bild dem zeitlich naechsten Scan des Geraets zu.
 */
export async function POST(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const { db, account } = auth;

  const cameraId = Number(request.nextUrl.searchParams.get("cameraId"));
  const deviceId = Number(request.nextUrl.searchParams.get("deviceId"));
  const atRaw = request.nextUrl.searchParams.get("at");
  const at = atRaw ? new Date(atRaw) : new Date();
  if (!Number.isInteger(cameraId) || !Number.isInteger(deviceId) || isNaN(at.getTime())) {
    return NextResponse.json({ error: "cameraId/deviceId/at ungültig" }, { status: 400 });
  }

  // Frische-Sperre: Aufnahmen, die deutlich nach dem Scan-Zeitpunkt
  // entstanden sind (Hub-Backlog), nicht mehr zuordnen – sie zeigen mit
  // hoher Wahrscheinlichkeit die falsche Person.
  if (Date.now() - at.getTime() > 45_000) {
    return NextResponse.json({ ok: true, attached: false, stale: true });
  }

  const buf = Buffer.from(await request.arrayBuffer());
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    return NextResponse.json({ error: "Kein gültiges JPEG" }, { status: 400 });
  }
  if (buf.length > MAX_SNAPSHOT_BYTES) {
    return NextResponse.json({ error: "Schnappschuss zu groß" }, { status: 413 });
  }

  // Zeitlich naechsten Scan des Geraets suchen (kleinste Distanz zu `at`).
  const candidates = await db.scan.findMany({
    where: {
      accountId: account.id,
      deviceId,
      scanTime: {
        gte: new Date(at.getTime() - MATCH_BEFORE_MS),
        lte: new Date(at.getTime() + MATCH_AFTER_MS),
      },
    },
    select: { id: true, scanTime: true, snapshot: { select: { id: true } } },
    orderBy: { scanTime: "asc" },
    take: 20,
  });
  const scan = candidates
    .slice()
    .sort(
      (a, b) =>
        Math.abs(a.scanTime.getTime() - at.getTime()) -
        Math.abs(b.scanTime.getTime() - at.getTime())
    )[0];

  if (!scan) {
    // Scan wurde (noch) nicht geschrieben – Task gilt trotzdem als erledigt.
    return NextResponse.json({ ok: true, attached: false });
  }
  if (scan.snapshot) {
    // Es gibt bereits ein Bild (z. B. frueherer Task) – das erste, zeitnaeheste behalten.
    return NextResponse.json({ ok: true, attached: false, scanId: scan.id });
  }

  await db.scanSnapshot.create({
    data: {
      scanId: scan.id,
      cameraId,
      image: buf,
      capturedAt: new Date(),
      accountId: account.id,
    },
  });

  return NextResponse.json({ ok: true, attached: true, scanId: scan.id, bytes: buf.length });
}
