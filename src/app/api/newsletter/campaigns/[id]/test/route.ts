import { NextRequest, NextResponse } from "next/server";
import { readRequestBody } from "@/lib/api-body";
import { normalizeEmail } from "@/lib/day-guest";
import { idParam, newsletterAdmin } from "@/lib/newsletter/admin-auth";
import { loadSendContext, sendTestMail } from "@/lib/newsletter/service";

export const maxDuration = 30;

/** Testmail an bis zu fünf Adressen ({ to: ["…"] }); ohne Angabe an die eigene. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await newsletterAdmin();
  if ("error" in auth) return auth.error;
  const id = idParam((await params).id);
  if (!id) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  const body = await readRequestBody(request);
  const list = Array.isArray(body?.to) ? body.to : typeof body?.to === "string" ? body.to.split(/[,;\s]+/) : [auth.userEmail];
  const to = [...new Set(list.map((v: unknown) => normalizeEmail(v)).filter((v: string | null): v is string => !!v))].slice(0, 5);
  if (to.length === 0) return NextResponse.json({ error: "Bitte mindestens eine gültige Adresse angeben" }, { status: 400 });

  const campaign = await auth.db.newsletterCampaign.findFirst({ where: { id, accountId: auth.accountId } });
  if (!campaign) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  const ctx = await loadSendContext(auth.accountId);
  const blocking = ctx.gaps.filter((g) => !g.startsWith("Versand ist ausgeschaltet"));
  if (blocking.length) return NextResponse.json({ error: `Versand nicht bereit: ${blocking.join(", ")}` }, { status: 409 });

  const result = await sendTestMail(auth.accountId, campaign, to);
  return NextResponse.json(result, { status: result.sent.length ? 200 : 502 });
}
