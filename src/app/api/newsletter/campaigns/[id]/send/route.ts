import { NextRequest, NextResponse } from "next/server";
import { idParam, newsletterAdmin } from "@/lib/newsletter/admin-auth";
import { queueCampaign } from "@/lib/newsletter/service";

export const maxDuration = 30;

/** Aussendung starten. Der Cron verschickt sie danach in Raten. */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await newsletterAdmin();
  if ("error" in auth) return auth.error;
  const id = idParam((await params).id);
  if (!id) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  const result = await queueCampaign(auth.accountId, id);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, recipients: result.recipients });
}
