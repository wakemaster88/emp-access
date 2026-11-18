import { NextRequest, NextResponse } from "next/server";
import { articleSchema, badRequest, wawiSession } from "@/lib/warenwirtschaft-server";

/** GET /api/warenwirtschaft/articles – alle Artikel des Kontos (ohne Bilder). */
export async function GET() {
  const s = await wawiSession();
  if ("error" in s) return s.error;
  const articles = await s.db.article.findMany({
    where: { accountId: s.accountId },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    omit: { image: true },
  });
  return NextResponse.json(articles);
}

/** POST /api/warenwirtschaft/articles – Artikel anlegen. */
export async function POST(request: NextRequest) {
  const s = await wawiSession();
  if ("error" in s) return s.error;
  const parsed = articleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.flatten());
  const article = await s.db.article.create({
    data: { ...parsed.data, accountId: s.accountId },
    omit: { image: true },
  });
  return NextResponse.json(article, { status: 201 });
}
