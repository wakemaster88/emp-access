import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { countLinkState, isPlausibleCountToken } from "@/lib/warenwirtschaft";
import { PUBLIC_IMAGE_MAX_CHARS, publicCountSchema, publicImage } from "@/lib/warenwirtschaft-server";
import { applyLineChanges } from "@/lib/stocktake-audit";
import { countLineImageUrl, listImageSrcs, wantsImageUrls } from "@/lib/list-images";
import { inlineImageRows } from "@/lib/list-images-db";

/**
 * Öffentlicher Zähl-Link einer Inventur (`/zaehlen/<token>`), damit
 * Mitarbeiter am Handy ohne Login zählen können.
 *   GET   – Artikelliste dieser Inventur (mit `fotos=url` ohne Bilder,
 *           dafür `hasImage` und `imageUrl` je Zeile)
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

export async function GET(request: NextRequest, { params }: Ctx) {
  const token = (await params).token;
  const st = await load(token);
  if (!st) return NextResponse.json({ error: GONE.NONE }, { status: 404 });
  const state = countLinkState(st);
  if (state !== "OK") return NextResponse.json({ error: GONE[state], state }, { status: 410 });

  const head = {
    title: st.title,
    kind: st.kind,
    date: st.date.toISOString(),
    accountName: st.account.name,
    expiresAt: st.countTokenExpiresAt?.toISOString() ?? null,
  };
  const where = { stocktakeId: st.id, accountId: st.accountId };
  const orderBy = [{ category: "asc" as const }, { name: "asc" as const }];
  const fields = {
    id: true,
    name: true,
    sku: true,
    category: true,
    unit: true,
    counted: true,
    broken: true,
    countedBy: true,
  } as const;

  if (!wantsImageUrls(request.nextUrl.searchParams)) {
    // Ältere Handy-Seiten ohne `fotos=url` bekommen die Bilder wie bisher in der Liste.
    const lines = await prisma.stocktakeLine.findMany({
      where,
      orderBy,
      select: { ...fields, article: { select: { image: true } } },
    });
    return NextResponse.json(
      {
        ...head,
        lines: lines.map(({ article, ...l }) => ({
          ...l,
          image: publicImage(article?.image),
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // `fotos=url`: Liste ohne Bilder (die Seite gleicht laufend ab), je Zeile
  // `hasImage` und `imageUrl`; Fotos kommen einzeln über ./image.
  const lines = await prisma.stocktakeLine.findMany({
    where,
    orderBy,
    select: { ...fields, article: { select: { id: true, updatedAt: true } } },
  });
  const articleIds = [...new Set(lines.flatMap((l) => (l.article ? [l.article.id] : [])))];
  const [withImageRows, inlineRows] = await Promise.all([
    prisma.article.findMany({ where: { id: { in: articleIds }, accountId: st.accountId, image: { not: null } }, select: { id: true } }),
    inlineImageRows("article", articleIds, { accountId: st.accountId, maxDataUrlChars: PUBLIC_IMAGE_MAX_CHARS }),
  ]);
  // Sonderfälle wie bisher über publicImage: Web-Adressen ja, große Data-URLs
  // nicht (die kommen hier mit image: null und gelten als ohne Bild).
  const inline = inlineRows.map((r) => ({ id: r.id, image: publicImage(r.image) }));
  const hidden = new Set(inline.filter((r) => !r.image).map((r) => r.id));
  const withImage = withImageRows.filter((r) => !hidden.has(r.id));
  // Je Artikel die erste Zeile; über sie lädt ./image das Foto.
  const lineOf = new Map<number, { id: number; updatedAt: Date }>();
  for (const l of lines) if (l.article && !lineOf.has(l.article.id)) lineOf.set(l.article.id, { id: l.id, updatedAt: l.article.updatedAt });
  const srcs = listImageSrcs(withImage, inline, (articleId) => {
    const ref = lineOf.get(articleId)!;
    return countLineImageUrl(token, ref.id, ref.updatedAt);
  });

  return NextResponse.json(
    {
      ...head,
      lines: lines.map(({ article, ...l }) => {
        const imageUrl = article ? (srcs.get(article.id) ?? null) : null;
        return { ...l, hasImage: imageUrl != null, imageUrl };
      }),
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
