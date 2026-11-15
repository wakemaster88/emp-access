import { NextRequest, NextResponse } from "next/server";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { relyingPartyFrom, suggestPasskeyName } from "@/lib/passkey-utils";
import { mayManageCredentials, riderVerifyRegistration, setRiderCookie } from "@/lib/rider-auth";
import { NOT_ALLOWED, riderAuthContext } from "@/lib/rider-auth-api";

/** POST: Passkey prüfen und speichern; meldet danach direkt an. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const ctx = await riderAuthContext(request, params, "pk-reg");
  if ("error" in ctx) return ctx.error;
  if (!(await mayManageCredentials(ctx.profile))) return NOT_ALLOWED();

  const body = (await request.json().catch(() => null)) as { response?: RegistrationResponseJSON } | null;
  if (!body?.response || typeof body.response !== "object") {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  const ok = await riderVerifyRegistration(
    relyingPartyFrom(request.headers),
    ctx.profile,
    body.response,
    suggestPasskeyName(request.headers.get("user-agent")),
  );
  if (!ok) {
    return NextResponse.json({ error: "Der Passkey konnte nicht geprüft werden. Bitte noch einmal versuchen." }, { status: 400 });
  }
  return setRiderCookie(NextResponse.json({ ok: true }), ctx.profile);
}
