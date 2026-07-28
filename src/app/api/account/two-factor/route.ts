import { NextResponse } from "next/server";
import { requireCurrentAdmin } from "@/lib/account-security";
import { isTwoFactorActive } from "@/lib/two-factor";

export async function GET() {
  const { admin, error } = await requireCurrentAdmin();
  if (error) return error;

  return NextResponse.json({
    enabled: isTwoFactorActive(admin),
    // Einrichtung begonnen, aber noch nicht mit einem Code bestaetigt.
    pending: Boolean(admin.twoFactorSecret) && !admin.twoFactorEnabledAt,
    enabledAt: admin.twoFactorEnabledAt,
    recoveryCodesLeft: admin.twoFactorRecoveryCodes.length,
  });
}
