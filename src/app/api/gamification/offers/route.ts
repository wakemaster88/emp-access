import { after, NextRequest, NextResponse } from "next/server";
import { gamiAdminSession } from "@/lib/gamification-session";
import { offerSchema, normalizeOffer } from "@/lib/gamification-input";
import { runAccountAnnouncements } from "@/lib/rider-announce";

/** Laufzeitlimit der Route auf Vercel in Sekunden (gleicher Wert wie in vercel.json). */
export const maxDuration = 60;

/**
 * POST: Angebot oder News (`kind: "NEWS"`) für die Kunden-App anlegen; mit
 * `push` geht eine Meldung an die Kunden. News gelten ohne Angabe für beide Pässe.
 */
export async function POST(request: NextRequest) {
  const session = await gamiAdminSession();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const parsed = offerSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe" }, { status: 400 });
  }
  const last = await db.riderOffer.findFirst({
    where: { accountId, kind: parsed.data.kind ?? "OFFER" },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  const offer = await db.riderOffer.create({
    data: {
      ...(parsed.data.kind === "NEWS" && { kind: "NEWS" as const, audience: "ALL" as const }),
      ...normalizeOffer(parsed.data),
      pushPlanned: parsed.data.push ?? false,
      sortOrder: (last?.sortOrder ?? 0) + 1,
      accountId,
    },
  });
  if (offer.pushPlanned) after(() => runAccountAnnouncements(accountId).catch((e) => console.error("[announce]", e)));
  return NextResponse.json(offer, { status: 201 });
}
