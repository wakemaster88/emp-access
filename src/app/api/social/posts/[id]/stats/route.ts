import { NextRequest, NextResponse } from "next/server";
import { idParam, newsletterAdmin } from "@/lib/newsletter/admin-auth";
import { refreshSocialPostStats } from "@/lib/social/meta-store";

export const maxDuration = 30;

/** Zahlen eines über Meta geposteten Beitrags abrufen. */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await newsletterAdmin();
  if ("error" in auth) return auth.error;
  const id = idParam((await params).id);
  if (!id) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  const r = await refreshSocialPostStats(auth.accountId, id);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true });
}
