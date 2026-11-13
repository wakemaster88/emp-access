import { NextRequest, NextResponse } from "next/server";
import { passwordMatches, requireCurrentAdmin, wrongPassword } from "@/lib/account-security";
import { MAX_PASSKEYS_PER_ADMIN, createRegistrationOptions, relyingPartyFrom } from "@/lib/passkey";

/**
 * Startet das Anlegen eines Passkeys. Verlangt das Passwort: Eine
 * uebernommene Sitzung allein soll keinen dauerhaften Zugang hinterlegen.
 */
export async function POST(request: NextRequest) {
  const { admin, error } = await requireCurrentAdmin();
  if (error) return error;

  const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
  if (!(await passwordMatches(admin, body?.password))) return wrongPassword();

  const options = await createRegistrationOptions(relyingPartyFrom(request.headers), admin);
  if (!options) {
    return NextResponse.json(
      { error: `Höchstens ${MAX_PASSKEYS_PER_ADMIN} Passkeys je Konto. Bitte zuerst einen alten löschen.` },
      { status: 409 },
    );
  }
  return NextResponse.json(options, { headers: { "Cache-Control": "no-store" } });
}
