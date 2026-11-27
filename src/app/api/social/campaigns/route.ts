import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { readRequestBody } from "@/lib/api-body";
import { newsletterAdmin } from "@/lib/newsletter/admin-auth";
import { parseCampaignInput } from "@/lib/social/rules";
import { campaignData } from "@/lib/social/campaign-data";

/** Kampagne anlegen (Newsletter › Social Media). */
export async function POST(request: NextRequest) {
  const auth = await newsletterAdmin();
  if ("error" in auth) return auth.error;
  const parsed = parseCampaignInput(await readRequestBody(request));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const count = await auth.db.socialCampaign.count({ where: { accountId: auth.accountId } });
  if (count >= 500) return NextResponse.json({ error: "Höchstens 500 Kampagnen" }, { status: 409 });
  try {
    const campaign = await auth.db.socialCampaign.create({
      data: { accountId: auth.accountId, ...campaignData(parsed), createdBy: auth.userName || auth.userEmail },
      select: { id: true },
    });
    return NextResponse.json({ id: campaign.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "Dieses Kürzel hat schon eine andere Kampagne" }, { status: 409 });
    }
    throw err;
  }
}
