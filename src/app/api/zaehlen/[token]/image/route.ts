import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { countLinkState, isPlausibleCountToken } from "@/lib/warenwirtschaft";
import { PUBLIC_IMAGE_MAX_CHARS, publicImageSchema } from "@/lib/warenwirtschaft-server";
import { decodeImageDataUrl } from "@/lib/photo-url";
import { IMAGE_ROUTE_HEADERS } from "@/lib/list-images";

type Ctx = { params: Promise<{ token: string }> };

/**
 * GET /api/zaehlen/[token]/image?id=<Zeile> – Produktfoto einer Zählzeile.
 * Die Liste (`/api/zaehlen/[token]?fotos=url`) trägt nur diese Adresse samt
 * `v` (Änderungszeitpunkt des Artikels); jedes Foto wird einmal geladen.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  const token = (await params).token;
  if (!isPlausibleCountToken(token)) return NextResponse.json({ error: "Dieser Link ist nicht mehr gültig." }, { status: 404 });
  const st = await prisma.stocktake.findUnique({
    where: { countToken: token },
    select: { id: true, accountId: true, status: true, countToken: true, countTokenExpiresAt: true },
  });
  if (!st) return NextResponse.json({ error: "Dieser Link ist nicht mehr gültig." }, { status: 404 });
  if (countLinkState(st) !== "OK") return NextResponse.json({ error: "Zählen ist mit diesem Link nicht mehr möglich." }, { status: 410 });

  const lineId = Number(request.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(lineId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  const line = await prisma.stocktakeLine.findFirst({
    where: { id: lineId, stocktakeId: st.id, accountId: st.accountId },
    select: { article: { select: { image: true } } },
  });
  const stored = line?.article?.image ?? null;
  const image = stored && stored.length <= PUBLIC_IMAGE_MAX_CHARS ? decodeImageDataUrl(stored) : null;
  if (!image) return NextResponse.json({ error: "Kein Bild vorhanden" }, { status: 404 });

  return new NextResponse(Buffer.from(image.bytes), {
    headers: {
      "Content-Type": image.contentType,
      "Content-Length": String(image.bytes.length),
      ...IMAGE_ROUTE_HEADERS,
    },
  });
}

/**
 * POST /api/zaehlen/[token]/image – fehlendes Produktfoto vom Handy. Setzt
 * das Bild nur, wenn der Artikel noch keins hat, damit über den Link kein
 * vorhandenes Foto überschrieben werden kann.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  const token = (await params).token;
  if (!isPlausibleCountToken(token)) return NextResponse.json({ error: "Dieser Link ist nicht mehr gültig." }, { status: 404 });
  const st = await prisma.stocktake.findUnique({
    where: { countToken: token },
    select: { id: true, accountId: true, status: true, countToken: true, countTokenExpiresAt: true },
  });
  if (!st) return NextResponse.json({ error: "Dieser Link ist nicht mehr gültig." }, { status: 404 });
  if (countLinkState(st) !== "OK") return NextResponse.json({ error: "Zählen ist mit diesem Link nicht mehr möglich." }, { status: 410 });

  const parsed = publicImageSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const line = await prisma.stocktakeLine.findFirst({
    where: { id: parsed.data.id, stocktakeId: st.id, accountId: st.accountId },
    select: { articleId: true },
  });
  if (!line?.articleId) return NextResponse.json({ error: "Artikel nicht gefunden" }, { status: 404 });
  const res = await prisma.article.updateMany({
    where: { id: line.articleId, accountId: st.accountId, image: null },
    data: { image: parsed.data.image, imageSource: `Foto vom Handy (${parsed.data.name})` },
  });
  if (res.count === 0) return NextResponse.json({ error: "Dieser Artikel hat schon ein Foto" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
