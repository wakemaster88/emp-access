import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publicLinkRateLimit } from "@/lib/rate-limit";
import { buildLostItemCreateData } from "@/lib/lost-item-data";
import { lostItemCreateSchema } from "@/lib/validators";
import { checkinLostItemImageUrl, listImageSrcs, wantsImageUrls } from "@/lib/list-images";
import { inlineImageRows } from "@/lib/list-images-db";

async function resolveMonitor(token: string) {
  const monitor = await prisma.monitorConfig.findUnique({
    where: { token },
    select: { isActive: true, type: true, accountId: true },
  });
  if (!monitor || !monitor.isActive || monitor.type !== "CHECKIN") return null;
  return monitor;
}

function serialize(item: {
  id: number;
  kind: "FOUND" | "LOST_REPORT";
  description: string;
  foundDate: Date;
  image: string | null;
  contact: string | null;
  reporterName: string | null;
  callbackPhone: string | null;
  pickedUp: boolean;
  pickedUpAt: Date | null;
}) {
  return {
    id: item.id,
    kind: item.kind,
    description: item.description,
    foundDate: item.foundDate.toISOString(),
    image: item.image,
    contact: item.contact,
    reporterName: item.reporterName,
    callbackPhone: item.callbackPhone,
    pickedUp: item.pickedUp,
    pickedUpAt: item.pickedUpAt ? item.pickedUpAt.toISOString() : null,
  };
}

/**
 * Die Liste wird beim Öffnen des Fundsachen-Fensters und über die
 * Aktualisieren-Taste geladen, nicht im Takt abgefragt.
 */
const LOST_ITEMS_READ_LIMIT = { limit: 60, windowMs: 60_000 } as const;

/// Fundsachen- und Verlustmeldungen-Liste für einen Checkin-Monitor.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const limited = publicLinkRateLimit(request, token, "checkin-lost-items-read", LOST_ITEMS_READ_LIMIT);
  if (limited) return limited;
  const monitor = await resolveMonitor(token);
  if (!monitor) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const where = { accountId: monitor.accountId };
  const orderBy = [{ pickedUp: "asc" as const }, { foundDate: "desc" as const }];
  if (!wantsImageUrls(request.nextUrl.searchParams)) {
    // Ältere Kiosk-Tabs ohne `fotos=url` bekommen die Liste wie bisher mit Bild.
    const items = await prisma.lostItem.findMany({ where, orderBy, take: 500 });
    return NextResponse.json({ items: items.map(serialize) });
  }

  // `fotos=url`: Liste ohne Bildspalte, je Eintrag `hasImage` und `imageUrl`.
  const items = await prisma.lostItem.findMany({ where, orderBy, take: 500, omit: { image: true } });
  const ids = items.map((i) => i.id);
  const [withImage, inline] = await Promise.all([
    prisma.lostItem.findMany({ where: { ...where, id: { in: ids }, image: { not: null } }, select: { id: true } }),
    inlineImageRows("lostItem", ids, { accountId: monitor.accountId }),
  ]);
  const versions = new Map(items.map((i) => [i.id, i.updatedAt]));
  const srcs = listImageSrcs(withImage, inline, (itemId) => checkinLostItemImageUrl(token, itemId, versions.get(itemId)!));
  return NextResponse.json({
    items: items.map((it) => {
      const imageUrl = srcs.get(it.id) ?? null;
      return {
        id: it.id,
        kind: it.kind,
        description: it.description,
        foundDate: it.foundDate.toISOString(),
        hasImage: imageUrl != null,
        imageUrl,
        contact: it.contact,
        reporterName: it.reporterName,
        callbackPhone: it.callbackPhone,
        pickedUp: it.pickedUp,
        pickedUpAt: it.pickedUpAt ? it.pickedUpAt.toISOString() : null,
      };
    }),
  });
}

/// Fundsache oder Verlustmeldung am Shop-Monitor anlegen.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const limited = publicLinkRateLimit(request, token, "checkin-lost-items");
  if (limited) return limited;
  const monitor = await resolveMonitor(token);
  if (!monitor) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const body = await request.json();
  const parsed = lostItemCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const item = await prisma.lostItem.create({
    data: buildLostItemCreateData(parsed.data, monitor.accountId),
  });
  return NextResponse.json(serialize(item), { status: 201 });
}
