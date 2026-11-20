import { NextRequest, NextResponse } from "next/server";
import { publicRateLimit } from "@/lib/rate-limit";
import { relyingPartyFrom } from "@/lib/passkey-utils";
import { riderAnyLoginOptions } from "@/lib/rider-auth";

/** POST: Optionen für die Anmeldung mit Passkey ohne Link (Startseite der App). */
export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limited = publicRateLimit(ip, "rider-pk-any", { limit: 20, windowMs: 10 * 60_000 });
  if (limited) return limited;
  const options = await riderAnyLoginOptions(relyingPartyFrom(request.headers));
  return NextResponse.json(options, { headers: { "Cache-Control": "no-store" } });
}
