import { NextRequest, NextResponse } from "next/server";
import { gamiAdminSession } from "@/lib/gamification-session";
import { offerSchema, normalizeOffer } from "@/lib/gamification-input";

/** POST: Angebot für die Kunden-App anlegen. */
export async function POST(request: NextRequest) {
  const session = await gamiAdminSession();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const parsed = offerSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe" }, { status: 400 });
  }
  const last = await db.riderOffer.findFirst({
    where: { accountId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  const offer = await db.riderOffer.create({
    data: { ...normalizeOffer(parsed.data), sortOrder: (last?.sortOrder ?? 0) + 1, accountId },
  });
  return NextResponse.json(offer, { status: 201 });
}
