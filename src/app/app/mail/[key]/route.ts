import { NextRequest, NextResponse } from "next/server";
import { publicRateLimit } from "@/lib/rate-limit";
import { verifyMailLinkKey } from "@/lib/day-guest";
import { completeOnboarding, onboardingState } from "@/lib/rider-onboarding";
import { riderAppPath } from "@/lib/rider-app";

export const dynamic = "force-dynamic";

/**
 * Link aus der Anmelde-Mail. Gibt es zur Adresse Abos, die noch in keinem
 * Profil sind, geht es zur Auswahl. Sonst direkt in die App (vorhandenes oder
 * neues Profil): beim ersten Mal zum Einrichten, danach zur Anmeldung. Ein
 * abgelaufener oder falscher Link führt zur Startseite.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const home = new URL("/app?link=abgelaufen", request.url);
  if (publicRateLimit(ip, "rider-mail-open", { limit: 20, windowMs: 10 * 60_000 })) return NextResponse.redirect(home);

  const { key } = await params;
  const link = verifyMailLinkKey(key);
  if (!link) return NextResponse.redirect(home);

  const state = await onboardingState(link.accountId, link.email);
  if (state.abos.length > 0) return NextResponse.redirect(new URL(`/app/willkommen/${encodeURIComponent(key)}`, request.url));
  const token = state.token ?? (await completeOnboarding(link.accountId, link.email, []));
  return NextResponse.redirect(token ? new URL(riderAppPath(token), request.url) : home);
}
