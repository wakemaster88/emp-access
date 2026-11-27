import { NextRequest, NextResponse } from "next/server";
import { idParam, newsletterAdmin } from "@/lib/newsletter/admin-auth";
import { cancelCampaign } from "@/lib/newsletter/service";

/** Laufende Aussendung anhalten. Schon verschickte Mails bleiben verschickt. */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await newsletterAdmin();
  if ("error" in auth) return auth.error;
  const id = idParam((await params).id);
  if (!id) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  const ok = await cancelCampaign(auth.accountId, id);
  if (!ok) return NextResponse.json({ error: "Diese Aussendung läuft nicht" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
