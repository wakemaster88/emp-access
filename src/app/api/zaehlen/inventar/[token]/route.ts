import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ALL_GROUPS, LINK_GONE, groupFilter, loadInventoryLink } from "@/lib/inventory-count-link";
import { ASSET_GROUPS } from "@/lib/warenwirtschaft";
import { publicAssetCountSchema, publicImage } from "@/lib/warenwirtschaft-server";

/**
 * Öffentlicher Zähl-Link des Inventars (`/zaehlen/inventar/<token>`), für
 * alle Blätter (`group = "*"`) oder ein einzelnes.
 *   GET   – Posten mit Blatt, Menge im Zähljahr und im Vorjahr
 *   PATCH – Mengen des Zähljahrs speichern (null löscht)
 * Der Token ist die Berechtigung und gilt nur für sein Konto und seine Blätter.
 */
type Ctx = { params: Promise<{ token: string }> };

async function link(ctx: Ctx) {
  const l = await loadInventoryLink((await ctx.params).token);
  if (!l) return { error: NextResponse.json({ error: LINK_GONE.NONE }, { status: 404 }) };
  if (l === "EXPIRED") return { error: NextResponse.json({ error: LINK_GONE.EXPIRED }, { status: 410 }) };
  return { link: l };
}

export async function GET(_request: NextRequest, ctx: Ctx) {
  const r = await link(ctx);
  if ("error" in r) return r.error;
  const { accountId, group, year, expiresAt, account } = r.link;
  const assets = await prisma.inventoryAsset.findMany({
    where: { accountId, ...groupFilter(group) },
    orderBy: [{ group: "asc" }, { location: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      group: true,
      location: true,
      deviceNumber: true,
      image: true,
      counts: { where: { year: { in: [year, year - 1] } }, select: { year: true, quantity: true, countedBy: true } },
    },
  });
  // Blätter in der Reihenfolge der Vorlage, weitere alphabetisch dahinter.
  const present = [...new Set(assets.map((a) => a.group))];
  const groups =
    group === ALL_GROUPS
      ? [...ASSET_GROUPS.filter((g) => present.includes(g)), ...present.filter((g) => !(ASSET_GROUPS as readonly string[]).includes(g)).sort()]
      : [group];
  return NextResponse.json(
    {
      group,
      groups,
      year,
      accountName: account.name,
      expiresAt: expiresAt.toISOString(),
      assets: assets.map((a) => {
        const now = a.counts.find((c) => c.year === year);
        // Vorjahr: letzte Zählung vor dem Zähljahr als Orientierung.
        const prev = a.counts.find((c) => c.year === year - 1);
        return {
          id: a.id,
          name: a.name,
          group: a.group,
          location: a.location,
          deviceNumber: a.deviceNumber,
          image: publicImage(a.image),
          quantity: now?.quantity ?? null,
          countedBy: now?.countedBy ?? null,
          previous: prev?.quantity ?? null,
        };
      }),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const r = await link(ctx);
  if ("error" in r) return r.error;
  const { accountId, group, year } = r.link;
  const parsed = publicAssetCountSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const countedBy = parsed.data.name;
  const ids = parsed.data.counts.map((c) => c.assetId);
  const own = new Set(
    (await prisma.inventoryAsset.findMany({ where: { id: { in: ids }, accountId, ...groupFilter(group) }, select: { id: true } })).map((a) => a.id),
  );
  for (const c of parsed.data.counts) {
    if (!own.has(c.assetId)) continue;
    if (c.quantity == null) {
      await prisma.inventoryAssetCount.deleteMany({ where: { assetId: c.assetId, year, accountId } });
    } else {
      await prisma.inventoryAssetCount.upsert({
        where: { assetId_year: { assetId: c.assetId, year } },
        create: { accountId, assetId: c.assetId, year, quantity: c.quantity, countedBy },
        update: { quantity: c.quantity, countedBy },
      });
    }
  }
  return NextResponse.json({ ok: true });
}
