import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { parseStreamUrl } from "@/lib/audio-integration";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const { id } = await params;
  const streamId = Number(id);
  if (isNaN(streamId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const existing = await db.audioStream.findFirst({
    where: { id: streamId, accountId: accountId! },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const body = await request.json();
  const name =
    typeof body.name === "string" && body.name.trim() ? body.name.trim() : undefined;

  let url: string | undefined;
  if (body.url !== undefined) {
    const parsed = parseStreamUrl(body.url);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    url = parsed.url;
  }

  const stream = await db.audioStream.update({
    where: { id: streamId },
    data: { name, url },
  });

  // Denormalisierte Kopie auf den Zonen nachziehen, damit Abspieler die
  // neue URL ohne Join sehen.
  if (url) {
    await db.audioZone.updateMany({
      where: { streamId, accountId: accountId! },
      data: { streamUrl: url },
    });
  }

  return NextResponse.json(stream);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const { id } = await params;
  const streamId = Number(id);
  if (isNaN(streamId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const existing = await db.audioStream.findFirst({
    where: { id: streamId, accountId: accountId! },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  await db.audioZone.updateMany({
    where: { streamId, accountId: accountId! },
    data: { streamId: null, streamUrl: null },
  });
  await db.audioStream.delete({ where: { id: streamId } });
  return NextResponse.json({ ok: true });
}
