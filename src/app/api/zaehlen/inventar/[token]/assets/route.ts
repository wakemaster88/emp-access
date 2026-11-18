import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { LINK_GONE, loadInventoryLink } from "@/lib/inventory-count-link";
import { MAX_PUBLIC_ARTICLES, publicAssetSchema } from "@/lib/warenwirtschaft-server";

type Ctx = { params: Promise<{ token: string }> };

const NOTE_PREFIX = "Beim Zählen am Handy angelegt";

/**
 * POST /api/zaehlen/inventar/[token]/assets – fehlenden Posten im Blatt des
 * Links anlegen, gleich mit Menge im Zähljahr. Gleicher Name im gleichen
 * Bereich → 409 mit dem vorhandenen Posten.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  const l = await loadInventoryLink((await params).token);
  if (!l) return NextResponse.json({ error: LINK_GONE.NONE }, { status: 404 });
  if (l === "EXPIRED") return NextResponse.json({ error: LINK_GONE.EXPIRED }, { status: 410 });
  const parsed = publicAssetSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { name: countedBy, asset: a } = parsed.data;

  const existing = await prisma.inventoryAsset.findFirst({
    where: {
      accountId: l.accountId,
      group: l.group,
      name: { equals: a.name, mode: "insensitive" },
      location: a.location ? { equals: a.location, mode: "insensitive" } : null,
    },
    select: { id: true },
  });
  if (existing) return NextResponse.json({ error: "Diesen Posten gibt es schon", id: existing.id }, { status: 409 });

  const added = await prisma.inventoryAsset.count({
    where: { accountId: l.accountId, group: l.group, note: { startsWith: NOTE_PREFIX }, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
  });
  if (added >= MAX_PUBLIC_ARTICLES) return NextResponse.json({ error: "Es wurden schon sehr viele Posten ergänzt. Bitte im Büro melden." }, { status: 429 });

  const day = new Date().toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" });
  const asset = await prisma.inventoryAsset.create({
    data: {
      accountId: l.accountId,
      group: l.group,
      name: a.name,
      location: a.location,
      note: `${NOTE_PREFIX} von ${countedBy} am ${day}.`,
      ...(a.quantity != null && { counts: { create: { accountId: l.accountId, year: l.year, quantity: a.quantity, countedBy } } }),
    },
    select: { id: true, name: true, location: true, deviceNumber: true },
  });
  return NextResponse.json({ ...asset, image: null, quantity: a.quantity ?? null, countedBy: a.quantity != null ? countedBy : null, previous: null }, { status: 201 });
}
