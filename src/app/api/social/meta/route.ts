import { NextRequest, NextResponse } from "next/server";
import { readRequestBody } from "@/lib/api-body";
import { newsletterAdmin } from "@/lib/newsletter/admin-auth";
import { chooseMetaPage, disconnectMeta } from "@/lib/social/meta-store";

export const maxDuration = 30;

/** Seite aus der Auswahl nach dem Anmelden übernehmen. */
export async function POST(request: NextRequest) {
  const auth = await newsletterAdmin();
  if ("error" in auth) return auth.error;
  const body = await readRequestBody(request);
  const pageId = typeof body?.pageId === "string" ? body.pageId.trim() : "";
  if (!/^\d{1,30}$/.test(pageId)) return NextResponse.json({ error: "Bitte eine Seite wählen" }, { status: 400 });
  const r = await chooseMetaPage(auth.accountId, pageId);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

/** Verbindung trennen: Tokens löschen, automatisches Posten aus. */
export async function DELETE() {
  const auth = await newsletterAdmin();
  if ("error" in auth) return auth.error;
  await disconnectMeta(auth.accountId);
  return NextResponse.json({ ok: true });
}
