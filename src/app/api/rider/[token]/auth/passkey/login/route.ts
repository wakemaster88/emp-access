import { NextRequest, NextResponse } from "next/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { relyingPartyFrom } from "@/lib/passkey-utils";
import { riderVerifyLogin, setRiderCookie } from "@/lib/rider-auth";
import { riderAuthContext } from "@/lib/rider-auth-api";

/** POST: Anmeldung mit Passkey abschließen. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const ctx = await riderAuthContext(request, params, "pk-login");
  if ("error" in ctx) return ctx.error;
  const body = (await request.json().catch(() => null)) as { response?: AuthenticationResponseJSON } | null;
  if (!body?.response || typeof body.response !== "object") {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const ok = await riderVerifyLogin(relyingPartyFrom(request.headers), ctx.profile, body.response);
  if (!ok) return NextResponse.json({ error: "Die Anmeldung mit Passkey hat nicht geklappt." }, { status: 401 });
  return setRiderCookie(NextResponse.json({ ok: true }), ctx.profile);
}
