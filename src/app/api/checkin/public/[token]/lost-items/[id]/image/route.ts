import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publicLinkRateLimit } from "@/lib/rate-limit";
import { decodeImageDataUrl } from "@/lib/photo-url";
import { IMAGE_ROUTE_HEADERS } from "@/lib/list-images";

/**
 * Reine Lese-Route, jedes Foto wird je Version nur einmal geladen; beim
 * Durchblättern einer langen Liste kommen aber viele Fotos auf einmal.
 */
const IMAGE_READ_LIMIT = { limit: 600, windowMs: 60_000 } as const;

/**
 * GET: Foto einer Fundsache für den Check-in-Monitor. Die Liste
 * (`../lost-items?fotos=url`) trägt nur diese Adresse samt `v`
 * (Änderungszeitpunkt); jedes Foto wird einmal geladen und dann aus dem
 * Browser-Cache genommen.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string; id: string }> }
) {
  const { token, id } = await params;
  const limited = publicLinkRateLimit(request, token, "checkin-lost-items-image", IMAGE_READ_LIMIT);
  if (limited) return limited;
  const monitor = await prisma.monitorConfig.findUnique({
    where: { token },
    select: { isActive: true, type: true, accountId: true },
  });
  if (!monitor || !monitor.isActive || monitor.type !== "CHECKIN") {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const itemId = Number(id);
  if (!Number.isInteger(itemId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const item = await prisma.lostItem.findFirst({
    where: { id: itemId, accountId: monitor.accountId },
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
