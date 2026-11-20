import { NextRequest, NextResponse } from "next/server";
import { publicRateLimit } from "@/lib/rate-limit";
import { loadPortalPartner } from "@/lib/venue-events";
import { documentResponse } from "@/lib/venue-documents";

export const dynamic = "force-dynamic";

/** PDF eines eigenen Termins ansehen. Fremde Dokumente gibt es hier nicht. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const limited = publicRateLimit(token, "partner-portal-doc", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const partner = await loadPortalPartner(token);
  if (!partner) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  const docId = Number(id);
  if (!Number.isInteger(docId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  return documentResponse({ id: docId, accountId: partner.accountId, event: { partnerId: partner.id } }, true);
}
