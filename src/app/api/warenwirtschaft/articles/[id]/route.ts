import { NextRequest, NextResponse } from "next/server";
import { articleSchema, badRequest, notFound, wawiSession } from "@/lib/warenwirtschaft-server";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH /api/warenwirtschaft/articles/[id] – Artikel ändern. */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const s = await wawiSession();
  if ("error" in s) return s.error;
  const id = Number((await params).id);
  const parsed = articleSchema.partial().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.flatten());
  const data = { ...parsed.data };
  // Neues eigenes Foto ersetzt einen alten Bildnachweis.
  if (data.image !== undefined && data.imageSource === undefined) data.imageSource = null;
  const res = await s.db.article.updateMany({ where: { id, accountId: s.accountId }, data });
  if (res.count === 0) return notFound("Artikel");
  return NextResponse.json({ ok: true });
}

/** DELETE /api/warenwirtschaft/articles/[id] – abgeschlossene Inventuren behalten ihre Zeilen. */
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const s = await wawiSession();
  if ("error" in s) return s.error;
  const id = Number((await params).id);
  const res = await s.db.article.deleteMany({ where: { id, accountId: s.accountId } });
  if (res.count === 0) return notFound("Artikel");
  return NextResponse.json({ ok: true });
}
