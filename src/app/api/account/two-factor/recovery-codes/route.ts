import { NextRequest, NextResponse } from "next/server";
import { passwordMatches, requireCurrentAdmin, secondFactorProblem, wrongPassword } from "@/lib/account-security";
import { isTwoFactorActive, replaceRecoveryCodes } from "@/lib/two-factor";

/**
 * Erzeugt neue Wiederherstellungscodes; die alten verlieren dabei ihre
 * Gueltigkeit. Verlangt Passwort und einen gueltigen zweiten Faktor.
 */
export async function POST(request: NextRequest) {
  const { admin, error } = await requireCurrentAdmin();
  if (error) return error;

  if (!isTwoFactorActive(admin)) {
    return NextResponse.json({ error: "Zwei-Faktor ist nicht aktiv" }, { status: 409 });
  }

  const body = (await request.json().catch(() => ({}))) as { password?: unknown; code?: unknown };
  if (!(await passwordMatches(admin, body.password))) {
    return wrongPassword();
  }
  const secondProblem = await secondFactorProblem(admin, body.code);
  if (secondProblem) return secondProblem;

  const recoveryCodes = await replaceRecoveryCodes(admin.id);
  return NextResponse.json({ recoveryCodes });
}
