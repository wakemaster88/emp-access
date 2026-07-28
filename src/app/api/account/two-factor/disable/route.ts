import { NextRequest, NextResponse } from "next/server";
import { passwordMatches, requireCurrentAdmin, wrongPassword } from "@/lib/account-security";
import { disableTwoFactor, isTwoFactorActive, verifySecondFactor } from "@/lib/two-factor";

/**
 * Abschalten verlangt Passwort und – solange 2FA aktiv ist – einen gueltigen
 * zweiten Faktor. Sonst waere eine uebernommene Sitzung samt Passwort genug,
 * um den Schutz still zu entfernen.
 */
export async function POST(request: NextRequest) {
  const { admin, error } = await requireCurrentAdmin();
  if (error) return error;

  const body = (await request.json().catch(() => ({}))) as { password?: unknown; code?: unknown };

  if (!(await passwordMatches(admin, body.password))) return wrongPassword();

  if (isTwoFactorActive(admin)) {
    const second = await verifySecondFactor(admin, typeof body.code === "string" ? body.code : "");
    if (!second.ok) {
      const message =
        second.reason === "locked"
          ? "Zu viele Fehlversuche. Bitte später erneut versuchen."
          : "Code ungültig oder abgelaufen";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  await disableTwoFactor(admin.id);
  return NextResponse.json({ success: true });
}
