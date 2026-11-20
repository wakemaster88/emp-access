import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { countLinkState, isPlausibleCountToken } from "@/lib/warenwirtschaft";
import { publicCountSchema, publicImage } from "@/lib/warenwirtschaft-server";
import { applyLineChanges } from "@/lib/stocktake-audit";

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

  // Protokoll mit dem eingegebenen Namen; die Bestätigung erfolgt später mit Login.
  const countedBy = parsed.data.name;
  await applyLineChanges(prisma, st.id, st.accountId, { name: countedBy, via: "link" }, parsed.data.lines, { countedBy });
  return NextResponse.json({ ok: true });
}
