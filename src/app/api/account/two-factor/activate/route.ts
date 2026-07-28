import { NextRequest, NextResponse } from "next/server";
import { requireCurrentAdmin } from "@/lib/account-security";
import { activateTwoFactor, isTwoFactorActive } from "@/lib/two-factor";

/** Bestaetigt die Einrichtung mit einem Code und liefert die Wiederherstellungscodes. */
export async function POST(request: NextRequest) {
  const { admin, error } = await requireCurrentAdmin();
  if (error) return error;

  if (isTwoFactorActive(admin)) {
    return NextResponse.json({ error: "Zwei-Faktor ist bereits aktiv" }, { status: 409 });
  }
  if (!admin.twoFactorSecret) {
    return NextResponse.json({ error: "Einrichtung wurde nicht gestartet" }, { status: 409 });
  }

  const body = await request.json().catch(() => ({}));
  const code = typeof (body as { code?: unknown }).code === "string" ? (body as { code: string }).code : "";

  const result = await activateTwoFactor(admin, code);
  if (!result.ok) {
    const message =
      result.reason === "unreadable"
        ? "Secret konnte nicht gelesen werden. Bitte Einrichtung neu starten."
        : "Code ungültig oder abgelaufen";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  return NextResponse.json({ recoveryCodes: result.recoveryCodes });
}
