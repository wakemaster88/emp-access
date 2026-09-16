import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getSessionWithDb } from "@/lib/api-auth";
import { optionsToJson, parseControlInput, queueSoundwebSync } from "@/lib/soundweb-server";
import { parseSelectOptions } from "@/lib/soundweb";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const { id } = await params;
  const controlId = Number(id);
  if (!Number.isInteger(controlId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const existing = await db.soundwebControl.findFirst({ where: { id: controlId, accountId: accountId! } });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Ungültiger Body" }, { status: 400 });

  const input = parseControlInput(body, { ...existing, options: parseSelectOptions(existing.options) });
  if ("error" in input) return NextResponse.json({ error: input.error }, { status: 400 });

  const addressChanged =
    input.kind !== existing.kind ||
    input.node !== existing.node ||
    input.virtualDevice !== existing.virtualDevice ||
    input.objectId !== existing.objectId ||
    input.stateVariable !== existing.stateVariable;

  const control = await db.soundwebControl.update({
    where: { id: controlId },
    data: {
      ...input,
      options: input.options ? optionsToJson(input.options) : Prisma.JsonNull,
      // Ein anderer Regler hat einen anderen Wert – den alten nicht weiterzeigen.
      ...(addressChanged ? { value: null, valueAt: null } : {}),
    },
  });
  await queueSoundwebSync(db, accountId!);
  return NextResponse.json(control);
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const { id } = await params;
  const controlId = Number(id);
  if (!Number.isInteger(controlId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const existing = await db.soundwebControl.findFirst({
    where: { id: controlId, accountId: accountId! },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  await db.soundwebControl.delete({ where: { id: controlId } });
  await queueSoundwebSync(db, accountId!);
  return NextResponse.json({ ok: true });
}
