import { after, NextRequest, NextResponse } from "next/server";
import { publicRateLimit } from "@/lib/rate-limit";
import { normalizeEmail } from "@/lib/day-guest";
import { requestAppLink } from "@/lib/rider-onboarding";

/**
 * POST: Link zur App per Mail anfordern (Anmeldung mit oder ohne Abo). Die
 * Mail geht nur an die eingegebene Adresse. Die Antwort ist immer dieselbe,
 * damit niemand herausfindet, welche Adressen bekannt sind.
 */
export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limited = publicRateLimit(ip, "rider-mail-link", { limit: 5, windowMs: 10 * 60_000 });
  if (limited) return limited;

  const body = (await request.json().catch(() => null)) as { email?: unknown } | null;
  const email = normalizeEmail(body?.email);
  if (!email) return NextResponse.json({ error: "Bitte eine gültige E-Mail-Adresse eingeben." }, { status: 400 });

  const origin = (process.env.AUTH_URL || process.env.NEXTAUTH_URL || new URL(request.url).origin).replace(/\/$/, "");
  // Erst nach der Antwort suchen und senden: so verrät auch die Dauer nichts.
  after(() =>
    requestAppLink(email, origin).catch((err) => {
      console.error("[rider] mail link failed:", err);
    }),
  );
  return NextResponse.json({ ok: true });
}
