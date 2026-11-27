import { NextRequest, NextResponse } from "next/server";
import { readRequestBody } from "@/lib/api-body";
import { idParam, newsletterAdmin } from "@/lib/newsletter/admin-auth";
import { starterBlocks } from "@/components/newsletter/campaign-ui";

type Params = { params: Promise<{ id: string }> };

/**
 * Aussendungen einer Kampagne:
 * - { action: "create" }: neuen Entwurf für die Kampagne anlegen (Antwort { id })
 * - { action: "link", newsletterId }: vorhandene Aussendung zuordnen
 * - { action: "unlink", newsletterId }: Zuordnung lösen
 */
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await newsletterAdmin();
  if ("error" in auth) return auth.error;
  const id = idParam((await params).id);
  if (!id) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  const campaign = await auth.db.socialCampaign.findFirst({
    where: { id, accountId: auth.accountId },
    select: { id: true, name: true, landingUrl: true },
  });
  if (!campaign) return NextResponse.json({ error: "Kampagne nicht gefunden" }, { status: 404 });
  const body = await readRequestBody(request);
  const action = body?.action;

  if (action === "create") {
    const mail = await auth.db.emailConfig.findFirst({ where: { accountId: auth.accountId }, select: { websiteUrl: true } });
    const draft = await auth.db.newsletterCampaign.create({
      data: {
        accountId: auth.accountId,
        subject: campaign.name.slice(0, 150),
        blocks: starterBlocks(campaign.name, campaign.landingUrl ?? mail?.websiteUrl ?? null),
        groupIds: [],
        socialCampaignId: campaign.id,
        createdBy: auth.userName || auth.userEmail,
      },
      select: { id: true },
    });
    return NextResponse.json({ id: draft.id }, { status: 201 });
  }

  const newsletterId = idParam(String(body?.newsletterId ?? ""));
  if (!newsletterId || (action !== "link" && action !== "unlink")) {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const r = await auth.db.newsletterCampaign.updateMany({
    where:
      action === "link"
        ? { id: newsletterId, accountId: auth.accountId, socialCampaignId: null }
        : { id: newsletterId, accountId: auth.accountId, socialCampaignId: campaign.id },
    data: { socialCampaignId: action === "link" ? campaign.id : null },
  });
  if (r.count === 0) {
    return NextResponse.json(
      { error: action === "link" ? "Diese Aussendung gehört schon zu einer Kampagne" : "Diese Aussendung gehört nicht zu dieser Kampagne" },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true });
}
