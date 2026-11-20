import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { publicRateLimit } from "@/lib/rate-limit";
import { verifyMailLinkKey } from "@/lib/day-guest";
import { completeOnboarding } from "@/lib/rider-onboarding";
import { riderAppPath } from "@/lib/rider-app";
import { signInByMail } from "@/lib/rider-auth";
import { acceptFamilyInvite, FAMILY_INVITE_COOKIE } from "@/lib/rider-family-invite";

const schema = z.object({
  key: z.string().min(10).max(800),
  ticketIds: z.array(z.number().int().positive()).max(20).optional(),
  /** Mit Kundenkonto: wer man ist; null = fährt selbst nicht. */
  personId: z.number().int().positive().nullable().optional(),
});

/**
 * POST: Anmeldung abschließen. Der Schlüssel aus der Mail belegt die Adresse;
 * zugeordnet werden nur Abos bzw. Personen des Kontos, die zu genau dieser
 * Adresse gehören.
 */
export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limited = publicRateLimit(ip, "rider-onboarding", { limit: 10, windowMs: 10 * 60_000 });
  if (limited) return limited;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });
  const link = verifyMailLinkKey(parsed.data.key);
  if (!link) return NextResponse.json({ error: "Dieser Link gilt nicht mehr. Fordere einfach einen neuen an." }, { status: 401 });

  const token = await completeOnboarding(link.accountId, link.email, {
    ticketIds: parsed.data.ticketIds,
    personId: parsed.data.personId,
  });
  if (!token) return NextResponse.json({ error: "Die App ist gerade nicht freigeschaltet." }, { status: 403 });

  // Kam die Person über eine Einladung in eine Familie (Cookie aus /app/mail): jetzt beitreten.
  const family = request.cookies.get(FAMILY_INVITE_COOKIE)?.value;
  const joinError = family ? await acceptFamilyInvite(token, family) : null;
  const url = joinError && family ? `/app/familie/${encodeURIComponent(family)}` : riderAppPath(token);
  const res = await signInByMail(NextResponse.json({ url }), token, link.email);
  if (family) res.cookies.delete(FAMILY_INVITE_COOKIE);
  return res;
}
