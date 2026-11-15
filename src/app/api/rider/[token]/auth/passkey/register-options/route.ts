import { NextRequest, NextResponse } from "next/server";
import { relyingPartyFrom } from "@/lib/passkey-utils";
import { mayManageCredentials, riderRegistrationOptions } from "@/lib/rider-auth";
import { NOT_ALLOWED, riderAuthContext } from "@/lib/rider-auth-api";

/** POST: Optionen zum Anlegen eines Passkeys. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const ctx = await riderAuthContext(request, params, "pk-reg");
  if ("error" in ctx) return ctx.error;
  if (!(await mayManageCredentials(ctx.profile))) return NOT_ALLOWED();

  const options = await riderRegistrationOptions(relyingPartyFrom(request.headers), ctx.profile, "Deine Saison");
  if (!options) {
    return NextResponse.json({ error: "Du hast schon die höchste Zahl an Passkeys eingerichtet." }, { status: 409 });
  }
  return NextResponse.json(options, { headers: { "Cache-Control": "no-store" } });
}
