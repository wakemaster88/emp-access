import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { publicRateLimit } from "@/lib/rate-limit";
import { verifyCurrentMailLinkKey } from "@/lib/day-guest";
import { completeOnboarding } from "@/lib/rider-onboarding";
import { riderAppPath } from "@/lib/rider-app";
import { mailLinkSession, setRiderCookie } from "@/lib/rider-auth";
import { FAMILY_INVITE_COOKIE, pendingFamilyInvite } from "@/lib/rider-family-invite";

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
  const link = await verifyCurrentMailLinkKey(parsed.data.key);
  if (!link) return NextResponse.json({ error: "Dieser Link gilt nicht mehr. Fordere einfach einen neuen an." }, { status: 401 });

  const token = await completeOnboarding(link.accountId, link.email, {
    ticketIds: parsed.data.ticketIds,
    personId: parsed.data.personId,
  });
  if (!token) return NextResponse.json({ error: "Die App ist gerade nicht freigeschaltet." }, { status: 403 });

  // Kam die Person über eine Einladung in eine Familie (Cookie aus /app/mail)?
  // Dann geht es zur Einladungsseite; beigetreten wird erst dort per Knopf.
  // Ohne Anmeldedaten zuerst einrichten, die App zeigt die Einladung danach.
  const cookie = request.cookies.get(FAMILY_INVITE_COOKIE)?.value;
  const invite = await pendingFamilyInvite(token, cookie);
  const session = await mailLinkSession(token, link.email, link.version);
  const url = invite && session ? `/app/familie/${encodeURIComponent(invite.key)}` : riderAppPath(token);
  const res = NextResponse.json({ url });
  if (cookie && !invite) res.cookies.delete(FAMILY_INVITE_COOKIE);
  return session ? setRiderCookie(res, session) : res;
}
