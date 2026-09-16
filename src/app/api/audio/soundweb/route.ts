import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import {
  parseDeviceInput,
  queueSoundwebSync,
  serializeSoundwebDevice,
  soundwebDeviceInclude,
} from "@/lib/soundweb-server";

/** Alle Soundweb-Prozessoren des Accounts mit ihren Reglern. */
export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const devices = await db.soundwebDevice.findMany({
    where: { accountId: accountId! },
    include: soundwebDeviceInclude,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return NextResponse.json(devices.map(serializeSoundwebDevice));
}

/** Prozessor anlegen: Name, Host, Port (Vorgabe 1023), HiQnet-Node. */
export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Ungültiger Body" }, { status: 400 });

  const input = parseDeviceInput(body);
  if ("error" in input) return NextResponse.json({ error: input.error }, { status: 400 });

  const device = await db.soundwebDevice.create({
    data: { ...input, accountId: accountId! },
    include: soundwebDeviceInclude,
  });
  await queueSoundwebSync(db, accountId!);
  return NextResponse.json(serializeSoundwebDevice(device), { status: 201 });
}
