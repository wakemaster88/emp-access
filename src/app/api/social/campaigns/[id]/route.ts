import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { readRequestBody } from "@/lib/api-body";
import { idParam, newsletterAdmin } from "@/lib/newsletter/admin-auth";
import { parseCampaignInput } from "@/lib/social/rules";
import { campaignData } from "@/lib/social/campaign-data";

type Params = { params: Promise<{ id: string }> };

/** Kampagne ändern. */
export async function PUT(request: NextRequest, { params }: Params) {
  const auth = await newsletterAdmin();
  if ("error" in auth) return auth.error;
  const id = idParam((await params).id);
  if (!id) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  const parsed = parseCampaignInput(await readRequestBody(request));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    const r = await auth.db.socialCampaign.updateMany({ where: { id, accountId: auth.accountId }, data: campaignData(parsed) });
    if (r.count === 0) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "Dieses Kürzel hat schon eine andere Kampagne" }, { status: 409 });
    }
    throw err;
  }
  return NextResponse.json({ ok: true });
}

/**
 * Kampagne mit ihren Beiträgen löschen. Die Aussendungen bleiben und gehören
 * danach zu keiner Kampagne mehr.
 */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const auth = await newsletterAdmin();
  if ("error" in auth) return auth.error;
  const id = idParam((await params).id);
  if (!id) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  const r = await auth.db.socialCampaign.deleteMany({ where: { id, accountId: auth.accountId } });
  if (r.count === 0) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
