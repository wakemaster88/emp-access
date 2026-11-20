import { NextRequest, NextResponse } from "next/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { publicRateLimit } from "@/lib/rate-limit";
import { relyingPartyFrom } from "@/lib/passkey-utils";
import { riderVerifyAnyLogin, setRiderCookie } from "@/lib/rider-auth";
import { riderAppPath } from "@/lib/rider-app";

/** POST: Anmeldung mit Passkey ohne Link abschließen; liefert den Weg zur eigenen App. */
export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limited = publicRateLimit(ip, "rider-pk-any-login", { limit: 20, windowMs: 10 * 60_000 });
  if (limited) return limited;
  const body = (await request.json().catch(() => null)) as { response?: AuthenticationResponseJSON } | null;
  if (!body?.response || typeof body.response !== "object") {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const profile = await riderVerifyAnyLogin(relyingPartyFrom(request.headers), body.response);
  if (!profile) {
    return NextResponse.json(
      { error: "Zu diesem Passkey haben wir keinen Zugang gefunden. Lass dir unten einen Link schicken." },
      { status: 401 },
    );
  }
  return setRiderCookie(NextResponse.json({ url: riderAppPath(profile.token) }), profile);
}
