import { NextRequest, NextResponse } from "next/server";
import { publicRateLimit } from "@/lib/rate-limit";
import { openDayGuestProfile, verifyMailLinkKey } from "@/lib/day-guest";
import { riderAppPath } from "@/lib/rider-app";

export const dynamic = "force-dynamic";

/**
 * Link aus der Mail an einen Tagesgast. Bündelt seine Tagestickets in einem
 * Profil und führt in die App: beim ersten Mal zum Einrichten, danach zur
 * Anmeldung. Ein abgelaufener oder falscher Link führt zur Startseite.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const home = new URL("/app?link=abgelaufen", request.url);
  if (publicRateLimit(ip, "rider-mail-open", { limit: 20, windowMs: 10 * 60_000 })) return NextResponse.redirect(home);

  const link = verifyMailLinkKey((await params).key);
  const token = link ? await openDayGuestProfile(link.accountId, link.email) : null;
  return NextResponse.redirect(token ? new URL(riderAppPath(token), request.url) : home);
}
