import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { countLinkState, isPlausibleCountToken } from "@/lib/warenwirtschaft";
import { publicCountSchema, publicImage } from "@/lib/warenwirtschaft-server";

/**
 * Öffentlicher Zähl-Link einer Inventur (`/zaehlen/<token>`), damit
 * Mitarbeiter am Handy ohne Login zählen können.
 *   GET   – Artikelliste dieser Inventur
 *   PATCH – Ist- und Bruchmengen speichern
 *
 * Der Token ist die Berechtigung. Deshalb geht hier nur raus, was zum Zählen
 * nötig ist: keine Einkaufspreise, kein Soll-Bestand (blinde Zählung) und
 * keine anderen Inventuren. Gilt nur, solange die Inventur offen ist.
 */

async function load(token: string) {
  if (!isPlausibleCountToken(token)) return null;
  return prisma.stocktake.findUnique({
    where: { countToken: token },
    select: {
      id: true,
      accountId: true,
      kind: true,
      title: true,
      date: true,
      status: true,
      countToken: true,
      countTokenExpiresAt: true,
      account: { select: { name: true } },
    },
  });
}

const GONE = {
  NONE: "Dieser Link ist nicht mehr gültig.",
  EXPIRED: "Dieser Link ist abgelaufen. Bitte einen neuen Link anfordern.",
  CLOSED: "Diese Inventur ist abgeschlossen.",
} as const;

type Ctx = { params: Promise<{ token: string }> };

export async function GET(_request: NextRequest, { params }: Ctx) {
  const st = await load((await params).token);
  if (!st) return NextResponse.json({ error: GONE.NONE }, { status: 404 });
  const state = countLinkState(st);
  if (state !== "OK") return NextResponse.json({ error: GONE[state], state }, { status: 410 });

  const lines = await prisma.stocktakeLine.findMany({
    where: { stocktakeId: st.id, accountId: st.accountId },
    orderBy: [{ category: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      sku: true,
      category: true,
      unit: true,
      counted: true,
      broken: true,
      countedBy: true,
      article: { select: { image: true } },
    },
  });

  return NextResponse.json(
    {
      title: st.title,
      kind: st.kind,
      date: st.date.toISOString(),
      accountName: st.account.name,
      expiresAt: st.countTokenExpiresAt?.toISOString() ?? null,
      lines: lines.map(({ article, ...l }) => ({
        ...l,
        image: publicImage(article?.image),
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const st = await load((await params).token);
  if (!st) return NextResponse.json({ error: GONE.NONE }, { status: 404 });
  const state = countLinkState(st);
  if (state !== "OK") return NextResponse.json({ error: GONE[state], state }, { status: 410 });

  const parsed = publicCountSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const countedBy = parsed.data.name;
  for (const l of parsed.data.lines) {
    const data: { counted?: number | null; broken?: number | null; countedBy: string } = { countedBy };
    if (l.counted !== undefined) data.counted = l.counted;
    if (l.broken !== undefined) data.broken = l.broken;
    await prisma.stocktakeLine.updateMany({ where: { id: l.id, stocktakeId: st.id, accountId: st.accountId }, data });
  }
  return NextResponse.json({ ok: true });
}
