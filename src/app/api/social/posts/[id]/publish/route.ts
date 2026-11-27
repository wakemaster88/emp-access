import { NextRequest, NextResponse } from "next/server";
import { idParam, newsletterAdmin } from "@/lib/newsletter/admin-auth";
import { publishSocialPost } from "@/lib/social/meta-store";

export const maxDuration = 60;

/** Beitrag jetzt über Meta auf Instagram oder Facebook veröffentlichen. */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await newsletterAdmin();
  if ("error" in auth) return auth.error;
  const id = idParam((await params).id);
  if (!id) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  const r = await publishSocialPost(auth.accountId, id, { waitMs: 15_000 });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.result.state === "PUBLISHED" ? { state: "PUBLISHED", postUrl: r.result.postUrl } : { state: "PROCESSING" });
}
