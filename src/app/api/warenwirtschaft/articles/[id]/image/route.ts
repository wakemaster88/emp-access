import { NextRequest, NextResponse } from "next/server";
import { notFound, wawiSession } from "@/lib/warenwirtschaft-server";
import { decodeImageDataUrl } from "@/lib/photo-url";
import { IMAGE_ROUTE_HEADERS } from "@/lib/list-images";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/warenwirtschaft/articles/[id]/image – eigenes Artikelfoto als Bild.
 * Artikel- und Inventurseite tragen nur diese Adresse samt `v`
 * (Änderungszeitpunkt); der Browser lädt jedes Foto einmal und behält es,
 * auch wenn die Inventurseite alle 30 s abgleicht. Web-Adressen (Open Food
 * Facts) stehen weiter direkt in der Liste.
 */
export async function GET(_request: NextRequest, { params }: Ctx) {
  const s = await wawiSession();
  if ("error" in s) return s.error;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return notFound("Artikel");
  const article = await s.db.article.findFirst({ where: { id, accountId: s.accountId }, select: { image: true } });
  const image = article?.image ? decodeImageDataUrl(article.image) : null;
  if (!image) return notFound("Bild");

  return new NextResponse(Buffer.from(image.bytes), {
    headers: {
      "Content-Type": image.contentType,
      "Content-Length": String(image.bytes.length),
      ...IMAGE_ROUTE_HEADERS,
    },
  });
}
