import { NextRequest, NextResponse } from "next/server";
import { readRequestBody } from "@/lib/api-body";
import { idParam, newsletterAdmin } from "@/lib/newsletter/admin-auth";
import { parseCampaignInput } from "@/lib/newsletter/campaign-input";

type Params = { params: Promise<{ id: string }> };

/** Entwurf ändern. Gestartete Aussendungen bleiben, wie sie verschickt wurden. */
export async function PUT(request: NextRequest, { params }: Params) {
  const auth = await newsletterAdmin();
  if ("error" in auth) return auth.error;
  const id = idParam((await params).id);
  if (!id) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  const parsed = parseCampaignInput(await readRequestBody(request));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const r = await auth.db.newsletterCampaign.updateMany({
    where: { id, accountId: auth.accountId, status: "DRAFT" },
    data: { subject: parsed.subject, preheader: parsed.preheader, blocks: parsed.blocks },
  });
  if (r.count === 0) return NextResponse.json({ error: "Nur Entwürfe lassen sich ändern" }, { status: 409 });
  return NextResponse.json({ ok: true });
}

/** Entwurf oder abgebrochene Aussendung löschen. Versendete bleiben als Nachweis. */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const auth = await newsletterAdmin();
  if ("error" in auth) return auth.error;
  const id = idParam((await params).id);
  if (!id) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  const r = await auth.db.newsletterCampaign.deleteMany({
    where: { id, accountId: auth.accountId, status: { in: ["DRAFT", "CANCELLED"] } },
  });
  if (r.count === 0) return NextResponse.json({ error: "Nur Entwürfe und abgebrochene Aussendungen lassen sich löschen" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
