import { NextRequest, NextResponse } from "next/server";
import { badRequest, countLinkCreateSchema, countTokenExpiry, newCountToken, notFound, wawiSession } from "@/lib/warenwirtschaft-server";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Zähl-Link fürs Handy einer offenen Inventur.
 *   POST   – neuen Link erzeugen (der alte wird damit ungültig)
 *   DELETE – Link sperren
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  const s = await wawiSession();
  if ("error" in s) return s.error;
  const id = Number((await params).id);
  const parsed = countLinkCreateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return badRequest(parsed.error.flatten());
  const st = await s.db.stocktake.findFirst({ where: { id, accountId: s.accountId }, select: { status: true } });
  if (!st) return notFound("Inventur");
  if (st.status !== "OPEN") return NextResponse.json({ error: "Inventur ist festgeschrieben" }, { status: 409 });
  const data = { countToken: newCountToken(), countTokenExpiresAt: countTokenExpiry(parsed.data.days) };
  await s.db.stocktake.updateMany({ where: { id, accountId: s.accountId, status: "OPEN" }, data });
  return NextResponse.json({ token: data.countToken, expiresAt: data.countTokenExpiresAt.toISOString() });
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const s = await wawiSession();
  if ("error" in s) return s.error;
  const id = Number((await params).id);
  const res = await s.db.stocktake.updateMany({
    where: { id, accountId: s.accountId },
    data: { countToken: null, countTokenExpiresAt: null },
  });
  if (res.count === 0) return notFound("Inventur");
  return NextResponse.json({ ok: true });
}
