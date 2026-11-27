import { NextRequest, NextResponse } from "next/server";
import { readRequestBody } from "@/lib/api-body";
import { idParam, newsletterAdmin } from "@/lib/newsletter/admin-auth";
import { nextPublishedAt, parsePostInput } from "@/lib/social/rules";

/** Beitrag zu einer Kampagne anlegen. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await newsletterAdmin();
  if ("error" in auth) return auth.error;
  const campaignId = idParam((await params).id);
  if (!campaignId) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  const campaign = await auth.db.socialCampaign.findFirst({ where: { id: campaignId, accountId: auth.accountId }, select: { id: true } });
  if (!campaign) return NextResponse.json({ error: "Kampagne nicht gefunden" }, { status: 404 });
  const parsed = parsePostInput(await readRequestBody(request));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const count = await auth.db.socialPost.count({ where: { accountId: auth.accountId, campaignId } });
  if (count >= 200) return NextResponse.json({ error: "Höchstens 200 Beiträge je Kampagne" }, { status: 409 });
  const post = await auth.db.socialPost.create({
    data: {
      accountId: auth.accountId,
      campaignId,
      ...parsed,
      publishedAt: nextPublishedAt(null, parsed),
      statsAt: parsed.reach !== null || parsed.interactions !== null || parsed.clicks !== null ? new Date() : null,
      createdBy: auth.userName || auth.userEmail,
    },
    select: { id: true },
  });
  return NextResponse.json({ id: post.id }, { status: 201 });
}
