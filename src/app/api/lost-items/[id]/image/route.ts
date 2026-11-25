import { NextRequest, NextResponse } from "next/server";
import { resolveLostItemAuth } from "@/lib/lost-item-auth";
import { decodeImageDataUrl } from "@/lib/photo-url";
import { IMAGE_ROUTE_HEADERS } from "@/lib/list-images";

/**
 * GET /api/lost-items/[id]/image – Foto einer Fundsache als Bild.
 * Die Liste auf /fundsachen (und die Fundsachen-API mit `fotos=url`) trägt
 * nur diese Adresse samt `v` (Änderungszeitpunkt); der Browser lädt jedes
 * Foto einmal und behält es.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await resolveLostItemAuth(request, "/api/lost-items/[id]/image");
  if ("error" in auth) return auth.error;

  const itemId = Number((await params).id);
  if (!Number.isInteger(itemId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  // Der Super-Admin sieht auf /fundsachen alle Einträge (ohne Kontofilter),
  // also auch deren Fotos; alle anderen nur die des eigenen Kontos.
  const { db, accountId, isSuperAdmin } = auth;
  const item = await db.lostItem.findFirst({
    where: isSuperAdmin ? { id: itemId } : { id: itemId, accountId },
    select: { image: true },
  });
  const image = item?.image ? decodeImageDataUrl(item.image) : null;
  if (!image) return NextResponse.json({ error: "Kein Bild vorhanden" }, { status: 404 });

  return new NextResponse(Buffer.from(image.bytes), {
    headers: {
      "Content-Type": image.contentType,
      "Content-Length": String(image.bytes.length),
      ...IMAGE_ROUTE_HEADERS,
    },
  });
}
