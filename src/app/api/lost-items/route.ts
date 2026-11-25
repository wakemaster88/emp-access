import { NextRequest, NextResponse } from "next/server";
import { resolveLostItemAuth } from "@/lib/lost-item-auth";
import { buildLostItemCreateData } from "@/lib/lost-item-data";
import { readRequestBody } from "@/lib/api-body";
import { lostItemCreateSchema } from "@/lib/validators";
import { listImageSrcs, lostItemImageUrl, wantsImageUrls } from "@/lib/list-images";
import { inlineImageRows } from "@/lib/list-images-db";

/**
 * GET /api/lost-items
 * Query-Parameter:
 *  - filter=open|pickedUp  – nur offene bzw. erledigte Einträge
 *  - kind=found|lostReport   – nur Fundsachen bzw. Verlustmeldungen
 *  - q=...                   – Volltextsuche
 *  - withImages=1            – Base64-Bilder mitliefern (bei Token-Zugriff
 *                              standardmäßig weggelassen)
 *  - fotos=url               – statt des Bildes `hasImage` und `imageUrl`
 *                              (Bild-Route /api/lost-items/[id]/image)
 */
export async function GET(request: NextRequest) {
  const auth = await resolveLostItemAuth(request);
  if ("error" in auth) return auth.error;
  const { db, accountId, viaToken } = auth;

  const params = request.nextUrl.searchParams;
  const filter = params.get("filter");
  const kindParam = params.get("kind");
  const q = params.get("q")?.trim();
  const imageUrls = wantsImageUrls(params);
  const withImages = !imageUrls && (!viaToken || params.get("withImages") === "1");

  const where = {
    accountId,
    ...(filter === "open" && { pickedUp: false }),
    ...(filter === "pickedUp" && { pickedUp: true }),
    ...(kindParam === "found" && { kind: "FOUND" as const }),
    ...(kindParam === "lostReport" && { kind: "LOST_REPORT" as const }),
    ...(q && {
      OR: [
        { description: { contains: q, mode: "insensitive" as const } },
        { contact: { contains: q, mode: "insensitive" as const } },
        { reporterName: { contains: q, mode: "insensitive" as const } },
        { callbackPhone: { contains: q, mode: "insensitive" as const } },
      ],
    }),
  };
  const orderBy = { foundDate: "desc" } as const;

  if (withImages) {
    const items = await db.lostItem.findMany({ where, orderBy, take: 500 });
    return NextResponse.json(items);
  }

  // Ohne Bilder: Bildspalte gar nicht erst laden, nur ob eines da ist.
  const items = await db.lostItem.findMany({ where, orderBy, take: 500, omit: { image: true } });
  const ids = items.map((i) => i.id);
  const [withImage, inline] = await Promise.all([
    db.lostItem.findMany({ where: { id: { in: ids }, accountId, image: { not: null } }, select: { id: true } }),
    imageUrls
      ? inlineImageRows("lostItem", ids, { accountId })
      : Promise.resolve([]),
  ]);
  const hasImage = new Set(withImage.map((r) => r.id));

  if (!imageUrls) {
    return NextResponse.json(items.map((it) => ({ ...it, hasImage: hasImage.has(it.id) })));
  }

  const versions = new Map(items.map((i) => [i.id, i.updatedAt]));
  const srcs = listImageSrcs(withImage, inline, (id) => lostItemImageUrl(id, versions.get(id)!));
  return NextResponse.json(
    items.map((it) => ({ ...it, hasImage: hasImage.has(it.id), imageUrl: srcs.get(it.id) ?? null }))
  );
}

/** POST /api/lost-items – Fundsache oder Verlustmeldung anlegen. */
export async function POST(request: NextRequest) {
  const auth = await resolveLostItemAuth(request);
  if ("error" in auth) return auth.error;
  const { db, accountId } = auth;

  const body = await readRequestBody(request);
  if (!body) {
    return NextResponse.json(
      { error: "Body fehlt oder ist kein gültiges JSON/Formular" },
      { status: 400 }
    );
  }
  const parsed = lostItemCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const item = await db.lostItem.create({
    data: buildLostItemCreateData(parsed.data, accountId),
  });
  return NextResponse.json(item, { status: 201 });
}
