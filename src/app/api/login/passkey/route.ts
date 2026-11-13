import { NextRequest, NextResponse } from "next/server";
import { hitLoginThrottle } from "@/lib/login-throttle";
import { createLoginOptions, relyingPartyFrom } from "@/lib/passkey";

/**
 * Startet eine Passkey-Anmeldung: liefert die Optionen fuer
 * navigator.credentials.get(). Geprueft wird die Antwort in authorize()
 * (Provider "passkey" in src/lib/auth.ts).
 */
export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const throttle = hitLoginThrottle(`passkey|${ip}`);
  if (!throttle.allowed) {
    return NextResponse.json(
      { error: "Zu viele Versuche. Bitte gleich noch einmal probieren." },
      { status: 429, headers: { "Retry-After": String(throttle.retryAfterSec) } },
    );
  }

  try {
    const options = await createLoginOptions(relyingPartyFrom(request.headers));
    return NextResponse.json(options, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Passkey-Anmeldung derzeit nicht möglich" }, { status: 500 });
  }
}
