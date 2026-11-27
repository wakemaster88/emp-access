import { NextResponse } from "next/server";
import { newsletterAdmin } from "@/lib/newsletter/admin-auth";
import { refreshRecentStats } from "@/lib/social/meta-store";

export const maxDuration = 60;

/** Zahlen der über Meta geposteten Beiträge der letzten 30 Tage jetzt abrufen. */
export async function POST() {
  const auth = await newsletterAdmin();
  if ("error" in auth) return auth.error;
  const r = await refreshRecentStats(auth.accountId, { limit: 20 });
  if (r.failed && !r.updated) return NextResponse.json({ error: r.lastError ?? "Abruf fehlgeschlagen" }, { status: 502 });
  return NextResponse.json(r);
}
