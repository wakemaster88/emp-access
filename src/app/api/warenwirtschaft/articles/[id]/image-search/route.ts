import { NextRequest, NextResponse } from "next/server";
import { notFound, wawiSession } from "@/lib/warenwirtschaft-server";
import { searchProductImages } from "@/lib/warenwirtschaft-images";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/warenwirtschaft/articles/[id]/image-search?q=…
 * Bildvorschläge von Open Food Facts für einen Artikel; `q` ersetzt den Namen.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  const s = await wawiSession();
  if ("error" in s) return s.error;
  const id = Number((await params).id);
  const article = await s.db.article.findFirst({ where: { id, accountId: s.accountId }, select: { name: true } });
  if (!article) return notFound("Artikel");
  const q = request.nextUrl.searchParams.get("q")?.trim().slice(0, 120) || article.name;
  const candidates = await searchProductImages(q);
  if (candidates === null) {
    return NextResponse.json({ error: "Open Food Facts antwortet gerade nicht. Versuch es in einer Minute erneut.", candidates: [] }, { status: 502 });
  }
  return NextResponse.json({ candidates });
}
