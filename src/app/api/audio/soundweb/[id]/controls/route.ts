import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { optionsToJson, parseControlInput, queueSoundwebSync } from "@/lib/soundweb-server";

/** Regler zu einem Prozessor anlegen. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const { id } = await params;
  const deviceId = Number(id);
  if (!Number.isInteger(deviceId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const device = await db.soundwebDevice.findFirst({
    where: { id: deviceId, accountId: accountId! },
    select: { id: true, _count: { select: { controls: true } } },
  });
  if (!device) return NextResponse.json({ error: "Prozessor nicht gefunden" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Ungültiger Body" }, { status: 400 });

  const input = parseControlInput({ ...body, sortOrder: body.sortOrder ?? device._count.controls });
  if ("error" in input) return NextResponse.json({ error: input.error }, { status: 400 });

  const control = await db.soundwebControl.create({
    data: {
      ...input,
      options: input.options ? optionsToJson(input.options) : undefined,
      deviceId: device.id,
      accountId: accountId!,
    },
  });
  await queueSoundwebSync(db, accountId!);
  return NextResponse.json(control, { status: 201 });
}
