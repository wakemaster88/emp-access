import { NextRequest, NextResponse } from "next/server";
import { readRequestBody } from "@/lib/api-body";
import { idParam, newsletterAdmin } from "@/lib/newsletter/admin-auth";
import { nextPublishedAt, parsePostInput } from "@/lib/social/rules";

type Params = { params: Promise<{ id: string }> };

/** Beitrag ändern (Text, Bilder, Termin, Zustand, Zahlen). */
export async function PUT(request: NextRequest, { params }: Params) {
  const auth = await newsletterAdmin();
  if ("error" in auth) return auth.error;
  const id = idParam((await params).id);
  if (!id) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  const previous = await auth.db.socialPost.findFirst({
    where: { id, accountId: auth.accountId },
    select: { status: true, publishedAt: true, reach: true, interactions: true, clicks: true, statsAt: true },
  });
  if (!previous) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  const parsed = parsePostInput(await readRequestBody(request));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const statsChanged =
    parsed.reach !== previous.reach || parsed.interactions !== previous.interactions || parsed.clicks !== previous.clicks;
  await auth.db.socialPost.updateMany({
    where: { id, accountId: auth.accountId },
    data: {
      ...parsed,
      publishedAt: nextPublishedAt(previous, parsed),
      statsAt: statsChanged ? new Date() : previous.statsAt,
    },
  });
  return NextResponse.json({ ok: true });
}

/** Beitrag löschen. Hochgeladene Bilder bleiben im Speicher (sie können in einem Newsletter stehen). */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const auth = await newsletterAdmin();
  if ("error" in auth) return auth.error;
  const id = idParam((await params).id);
  if (!id) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  const r = await auth.db.socialPost.deleteMany({ where: { id, accountId: auth.accountId } });
  if (r.count === 0) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
