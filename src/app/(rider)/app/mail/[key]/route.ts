import { NextRequest, NextResponse } from "next/server";
import { publicRateLimit } from "@/lib/rate-limit";
import { verifyMailLinkKey } from "@/lib/day-guest";
import { completeOnboarding, onboardingState } from "@/lib/rider-onboarding";
import { riderAppPath } from "@/lib/rider-app";
import { mailLinkSession, setRiderCookie } from "@/lib/rider-auth";
import { familyInviteInfo } from "@/lib/rider-family";
import { FAMILY_INVITE_COOKIE, familyInviteCookieOptions } from "@/lib/rider-family-invite";

export const dynamic = "force-dynamic";

/**
 * Link aus der Anmelde-Mail. Gibt es zur Adresse ein Konto, mit dem sich noch
 * niemand angemeldet hat, oder Abos ohne Profil, geht es zur Auswahl. Sonst
 * direkt in die App (vorhandenes oder neues Profil): beim ersten Mal zum
 * Einrichten, danach angemeldet (der Link belegt die Adresse). Ein
 * abgelaufener oder falscher Link führt zur Startseite.
 *
 * Mit `?familie=<schlüssel>` (Einladung per Mail, lib/rider-family-invite)
 * geht es nach der Anmeldung zur Einladungsseite. Beigetreten wird erst dort
 * per Knopf: Dieser Aufruf ist ein GET, den auch Postfächer beim Prüfen von
 * Links auslösen, er darf an der Familie nichts ändern. Der Schlüssel wartet
 * im Cookie, bis die Person entschieden hat.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const home = new URL("/app?link=abgelaufen", request.url);
  if (publicRateLimit(ip, "rider-mail-open", { limit: 20, windowMs: 10 * 60_000 })) return NextResponse.redirect(home);

  const { key } = await params;
  const link = verifyMailLinkKey(key);
  if (!link) return NextResponse.redirect(home);

  const familyKey = request.nextUrl.searchParams.get("familie");
  const invite = familyKey ? await familyInviteInfo(familyKey) : null;
  const family = invite && invite.accountId === link.accountId ? familyKey : null;

  const secure = request.nextUrl.protocol === "https:";

  const state = await onboardingState(link.accountId, link.email);
  if (state.abos.length > 0 || (state.konto?.persons.length ?? 0) > 0) {
    const res = NextResponse.redirect(new URL(`/app/willkommen/${encodeURIComponent(key)}`, request.url));
    if (family) res.cookies.set(FAMILY_INVITE_COOKIE, family, familyInviteCookieOptions(secure));
    return res;
  }
  const token = await completeOnboarding(link.accountId, link.email, {});
  if (!token) return NextResponse.redirect(home);
  // Angemeldet (Passwort oder Passkey besteht schon): direkt zur Einladung.
  // Sonst zuerst einrichten; die App zeigt die Einladung danach als Hinweis.
  const session = await mailLinkSession(token, link.email);
  const target = family && session ? `/app/familie/${encodeURIComponent(family)}` : riderAppPath(token);
  const res = NextResponse.redirect(new URL(target, request.url));
  if (family) res.cookies.set(FAMILY_INVITE_COOKIE, family, familyInviteCookieOptions(secure));
  return session ? setRiderCookie(res, session) : res;
}
