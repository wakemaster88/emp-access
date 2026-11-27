import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { readRequestBody } from "@/lib/api-body";
import { idParam, newsletterAdmin } from "@/lib/newsletter/admin-auth";
import { parseGroupName } from "@/lib/newsletter/rules";

type Params = { params: Promise<{ id: string }> };

/** Eigene Gruppe umbenennen. Feste Gruppen behalten ihren Namen. */
export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await newsletterAdmin();
  if ("error" in auth) return auth.error;
  const id = idParam((await params).id);
  if (!id) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  const parsed = parseGroupName((await readRequestBody(request))?.name);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    const r = await auth.db.newsletterGroup.updateMany({ where: { id, accountId: auth.accountId, key: null }, data: { name: parsed.name } });
    if (r.count === 0) return NextResponse.json({ error: "Feste Gruppen lassen sich nicht umbenennen" }, { status: 409 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "Eine Gruppe mit diesem Namen gibt es schon" }, { status: 409 });
    }
    throw err;
  }
  return NextResponse.json({ ok: true });
}

/**
 * Eigene Gruppe löschen. Die Abonnenten bleiben, nur die Zuordnung geht.
 * Nicht, solange ein Entwurf an diese Gruppe gehen soll: Der Entwurf ginge
 * sonst unbemerkt an mehr Leute.
 */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const auth = await newsletterAdmin();
  if ("error" in auth) return auth.error;
  const id = idParam((await params).id);
  if (!id) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  const draft = await auth.db.newsletterCampaign.findFirst({
    where: { accountId: auth.accountId, status: "DRAFT", groupIds: { has: id } },
    select: { subject: true },
  });
  if (draft) {
    return NextResponse.json({ error: `Der Entwurf „${draft.subject}“ soll an diese Gruppe gehen. Bitte dort zuerst die Empfänger ändern.` }, { status: 409 });
  }
  const r = await auth.db.newsletterGroup.deleteMany({ where: { id, accountId: auth.accountId, key: null } });
  if (r.count === 0) return NextResponse.json({ error: "Feste Gruppen lassen sich nicht löschen" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
