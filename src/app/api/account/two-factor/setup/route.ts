import { NextRequest, NextResponse } from "next/server";
import { passwordMatches, requireCurrentAdmin, wrongPassword } from "@/lib/account-security";
import { isTwoFactorActive, startTwoFactorSetup } from "@/lib/two-factor";
import { formatSecretForDisplay } from "@/lib/totp";

/** Erzeugt ein neues Secret. Scharf wird es erst mit /activate. */
export async function POST(request: NextRequest) {
  const { admin, error } = await requireCurrentAdmin();
  if (error) return error;

  // Ein laufendes Setup wuerde den aktiven zweiten Faktor ueberschreiben und
  // damit kurzzeitig aushebeln – erst abschalten, dann neu einrichten.
  if (isTwoFactorActive(admin)) {
    return NextResponse.json(
      { error: "Zwei-Faktor ist bereits aktiv. Zum Wechseln zuerst deaktivieren." },
      { status: 409 }
    );
  }

  const body = await request.json().catch(() => ({}));
  if (!(await passwordMatches(admin, (body as { password?: unknown }).password))) {
    return wrongPassword();
  }

  const { secret, url } = await startTwoFactorSetup(admin.id, admin.email);

  return NextResponse.json({
    secret,
    secretFormatted: formatSecretForDisplay(secret),
    url,
  });
}
