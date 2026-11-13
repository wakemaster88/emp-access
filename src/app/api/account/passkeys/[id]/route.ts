import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCurrentAdmin } from "@/lib/account-security";
import { cleanPasskeyName } from "@/lib/passkey";

type Params = { params: Promise<{ id: string }> };

async function ownPasskeyId(params: Params["params"], adminId: number): Promise<number | null> {
  const id = parseInt((await params).id, 10);
  if (!Number.isInteger(id)) return null;
  const passkey = await prisma.passkey.findFirst({ where: { id, adminId }, select: { id: true } });
  return passkey?.id ?? null;
}

/** Umbenennen. */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { admin, error } = await requireCurrentAdmin();
  if (error) return error;

  const id = await ownPasskeyId(params, admin.id);
  if (!id) return NextResponse.json({ error: "Passkey nicht gefunden" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  const name = cleanPasskeyName(body?.name);
  if (!name) return NextResponse.json({ error: "Bitte einen Namen eingeben" }, { status: 400 });

  await prisma.passkey.update({ where: { id }, data: { name } });
  return NextResponse.json({ ok: true, name });
}

/** Loeschen. Das Geraet selbst behaelt den Schluessel, er funktioniert hier nur nicht mehr. */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { admin, error } = await requireCurrentAdmin();
  if (error) return error;

  const id = await ownPasskeyId(params, admin.id);
  if (!id) return NextResponse.json({ error: "Passkey nicht gefunden" }, { status: 404 });

  await prisma.passkey.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
