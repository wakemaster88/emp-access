import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { countLinkState, isPlausibleCountToken } from "@/lib/warenwirtschaft";
import { MAX_PUBLIC_ARTICLES, publicArticleSchema } from "@/lib/warenwirtschaft-server";
import { logEvents, voidSignatures } from "@/lib/stocktake-audit";
import { equalsInsensitive } from "@/lib/like-escape";

type Ctx = { params: Promise<{ token: string }> };

/** Markierung in `Article.note`, damit das Büro neue Artikel vom Handy erkennt. */
const NOTE_PREFIX = "Beim Zählen am Handy angelegt";

/**
 * POST /api/zaehlen/[token]/articles – Artikel ergänzen, der beim Zählen
 * auffällt, aber noch nicht im System ist. Legt den Artikel (ohne Preis,
 * Bestand 0) und eine Zeile dieser Inventur an. Gibt es den Namen mit
 * gleicher Einheit in der Inventur schon, kommt 409 mit dieser Zeile.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  const token = (await params).token;
  if (!isPlausibleCountToken(token)) return NextResponse.json({ error: "Dieser Link ist nicht mehr gültig." }, { status: 404 });
  const st = await prisma.stocktake.findUnique({
    where: { countToken: token },
    select: { id: true, accountId: true, status: true, countToken: true, countTokenExpiresAt: true },
  });
  if (!st) return NextResponse.json({ error: "Dieser Link ist nicht mehr gültig." }, { status: 404 });
  if (countLinkState(st) !== "OK") return NextResponse.json({ error: "Zählen ist mit diesem Link nicht mehr möglich." }, { status: 410 });

  const parsed = publicArticleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { name: countedBy, article: a } = parsed.data;

  const existing = await prisma.stocktakeLine.findFirst({
    where: {
      stocktakeId: st.id,
      accountId: st.accountId,
      name: equalsInsensitive(a.name),
      unit: a.unit ? equalsInsensitive(a.unit) : null,
    },
    select: { id: true },
  });
  if (existing) return NextResponse.json({ error: "Diesen Artikel gibt es in der Liste schon", id: existing.id }, { status: 409 });

  const added = await prisma.article.count({ where: { accountId: st.accountId, note: { startsWith: NOTE_PREFIX }, stocktakeLines: { some: { stocktakeId: st.id } } } });
  if (added >= MAX_PUBLIC_ARTICLES) return NextResponse.json({ error: "Es wurden schon sehr viele Artikel ergänzt. Bitte im Büro melden." }, { status: 429 });

  const day = new Date().toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" });
  const line = await prisma.$transaction(async (tx) => {
    const article = await tx.article.create({
      data: {
        accountId: st.accountId,
        name: a.name,
        unit: a.unit,
        category: a.category,
        stock: 0,
        note: `${NOTE_PREFIX} von ${countedBy} am ${day}. Einkaufspreis fehlt noch.`,
      },
      select: { id: true },
    });
    return tx.stocktakeLine.create({
      data: {
        accountId: st.accountId,
        stocktakeId: st.id,
        articleId: article.id,
        name: a.name,
        category: a.category,
        unit: a.unit,
        expected: 0,
        counted: a.counted ?? null,
        countedBy,
      },
      select: { id: true, name: true, sku: true, category: true, unit: true, counted: true, broken: true, countedBy: true },
    });
  });
  const actor = { name: countedBy, via: "link" as const };
  await logEvents(prisma, st.id, st.accountId, actor, [{ type: "LINE_ADDED", lineId: line.id, lineName: line.name, field: "counted", newValue: line.counted }]);
  await voidSignatures(prisma, st.id, st.accountId, actor);
  return NextResponse.json({ ...line, image: null }, { status: 201 });
}
