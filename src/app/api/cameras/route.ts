import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

// Felder ohne Passwort und ohne Snapshot-Bytes (die UI laedt das Bild ueber
// die eigene Snapshot-Route).
const LIST_SELECT = {
  id: true,
  name: true,
  host: true,
  httpPort: true,
  https: true,
  username: true,
  channel: true,
  enabled: true,
  vehicleDetection: true,
  notes: true,
  snapshotAt: true,
  lastSeenAt: true,
} as const;

export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const cameras = await session.db.camera.findMany({
    where: { accountId: session.accountId! },
    select: LIST_SELECT,
    orderBy: { name: "asc" },
  });
  return NextResponse.json(cameras);
}

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const body = await request.json();
  const name = String(body.name ?? "").trim();
  const host = String(body.host ?? "").trim();
  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");
  if (!name || !host || !username || !password) {
    return NextResponse.json(
      { error: "Name, Host, Benutzername und Passwort sind erforderlich" },
      { status: 400 }
    );
  }

  const existing = await db.camera.findFirst({ where: { accountId: accountId!, name } });
  if (existing) {
    return NextResponse.json({ error: "Eine Kamera mit diesem Namen existiert bereits" }, { status: 400 });
  }

  const camera = await db.camera.create({
    data: {
      name,
      host,
      httpPort: Number.isInteger(Number(body.httpPort)) && Number(body.httpPort) > 0 ? Number(body.httpPort) : 80,
      https: body.https === true,
      username,
      password,
      channel: Number.isInteger(Number(body.channel)) && Number(body.channel) >= 0 ? Number(body.channel) : 0,
      enabled: body.enabled !== false,
      vehicleDetection: body.vehicleDetection !== false,
      notes: body.notes?.trim() || null,
      accountId: accountId!,
    },
    select: LIST_SELECT,
  });
  return NextResponse.json(camera, { status: 201 });
}
