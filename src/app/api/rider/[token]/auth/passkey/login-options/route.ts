import { NextRequest, NextResponse } from "next/server";
import { relyingPartyFrom } from "@/lib/passkey-utils";
import { riderLoginOptions } from "@/lib/rider-auth";
import { riderAuthContext } from "@/lib/rider-auth-api";

/** POST: Optionen für die Anmeldung mit Passkey. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const ctx = await riderAuthContext(request, params, "pk-login");
  if ("error" in ctx) return ctx.error;
  const options = await riderLoginOptions(relyingPartyFrom(request.headers), ctx.profile);
  if (!options) return NextResponse.json({ error: "Für diesen Zugang ist kein Passkey eingerichtet." }, { status: 404 });
  return NextResponse.json(options, { headers: { "Cache-Control": "no-store" } });
}
