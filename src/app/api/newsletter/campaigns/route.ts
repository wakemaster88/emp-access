import { NextRequest, NextResponse } from "next/server";
import { readRequestBody } from "@/lib/api-body";
import { newsletterAdmin } from "@/lib/newsletter/admin-auth";
import { knownGroupIds, parseCampaignInput } from "@/lib/newsletter/campaign-input";

/** Neue Aussendung als Entwurf anlegen. */
export async function POST(request: NextRequest) {
  const auth = await newsletterAdmin();
  if ("error" in auth) return auth.error;
  const parsed = parseCampaignInput(await readRequestBody(request));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const groupIds = await knownGroupIds(auth.db, auth.accountId, parsed.groupIds);
  const campaign = await auth.db.newsletterCampaign.create({
    data: {
      accountId: auth.accountId,
      subject: parsed.subject,
      preheader: parsed.preheader,
      blocks: parsed.blocks,
      groupIds,
      createdBy: auth.userName || auth.userEmail,
    },
  });
  return NextResponse.json({ id: campaign.id }, { status: 201 });
}
