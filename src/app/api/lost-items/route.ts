import { NextRequest, NextResponse } from "next/server";
import { resolveLostItemAuth } from "@/lib/lost-item-auth";
import { buildLostItemCreateData } from "@/lib/lost-item-data";
import { readRequestBody } from "@/lib/api-body";
import { lostItemCreateSchema } from "@/lib/validators";

/**
 * GET /api/lost-items
 * Query-Parameter:
 *  - filter=open|pickedUp  – nur offene bzw. erledigte Einträge
 *  - kind=found|lostReport   – nur Fundsachen bzw. Verlustmeldungen
 *  - q=...                   – Volltextsuche
 *  - withImages=1            – Base64-Bilder mitliefern (bei Token-Zugriff
 *                              standardmäßig weggelassen)
 */
export async function GET(request: NextRequest) {
  const auth = await resolveLostItemAuth(request);
  if ("error" in auth) return auth.error;
  const { db, accountId, viaToken } = auth;

  const params = request.nextUrl.searchParams;
  const filter = params.get("filter");
  const kindParam = params.get("kind");
  const q = params.get("q")?.trim();
  const withImages = !viaToken || params.get("withImages") === "1";

  const items = await db.lostItem.findMany({
    where: {
      accountId,
      ...(filter === "open" && { pickedUp: false }),
      ...(filter === "pickedUp" && { pickedUp: true }),
      ...(kindParam === "found" && { kind: "FOUND" }),
      ...(kindParam === "lostReport" && { kind: "LOST_REPORT" }),
      ...(q && {
        OR: [
          { description: { contains: q, mode: "insensitive" as const } },
          { contact: { contains: q, mode: "insensitive" as const } },
          { reporterName: { contains: q, mode: "insensitive" as const } },
          { callbackPhone: { contains: q, mode: "insensitive" as const } },
        ],
      }),
    },
    orderBy: { foundDate: "desc" },
    take: 500,
  });

  if (withImages) return NextResponse.json(items);

  return NextResponse.json(
    items.map(({ image, ...rest }) => ({ ...rest, hasImage: image != null }))
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
