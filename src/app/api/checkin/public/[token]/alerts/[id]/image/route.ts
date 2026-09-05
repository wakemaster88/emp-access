import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveBinary } from "@/lib/blob-store";

export const maxDuration = 10;

/**
 * GET: Bild zu einer Warnung als JPEG, `?i=` waehlt den Blickwinkel.
 *
 * Eigener Endpunkt statt Base64 in der Alarmliste: Die wird alle paar
 * Sekunden geholt, das Bild genau einmal.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string; id: string }> },
) {
  const { token, id } = await params;
  const alertId = Number(id);
  if (!Number.isInteger(alertId) || alertId <= 0) {
    return NextResponse.json({ error: "Ungueltige ID" }, { status: 400 });
  }
  const position = Number(request.nextUrl.searchParams.get("i") ?? "0");
  if (!Number.isInteger(position) || position < 0) {
    return NextResponse.json({ error: "Ungueltiger Blickwinkel" }, { status: 400 });
  }

  const monitor = await prisma.monitorConfig.findUnique({
    where: { token },
    select: { accountId: true, isActive: true, type: true },
  });
  if (!monitor || !monitor.isActive || monitor.type !== "CHECKIN") {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  // accountId ueber die Warnung mitpruefen: Ein Token darf nur die eigenen
  // Bilder sehen, auch wenn jemand eine fremde ID raet.
  const img = await prisma.monitorAlertImage.findFirst({
    where: {
      alertId,
      position,
      alert: { accountId: monitor.accountId },
    },
    select: { image: true, blobPathname: true, createdAt: true },
  });
  const bytes = img ? await resolveBinary({ blob: img.blobPathname, bytes: img.image }) : null;
  if (!img || !bytes) {
    return NextResponse.json({ error: "Kein Bild vorhanden" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/jpeg",
      // Bild aendert sich nicht mehr — der Monitor darf es behalten.
      "Cache-Control": "private, max-age=86400, immutable",
      "Last-Modified": img.createdAt.toUTCString(),
    },
  });
}
