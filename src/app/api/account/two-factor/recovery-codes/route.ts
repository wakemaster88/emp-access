import { NextRequest, NextResponse } from "next/server";
import { passwordMatches, requireCurrentAdmin, wrongPassword } from "@/lib/account-security";
import { isTwoFactorActive, replaceRecoveryCodes } from "@/lib/two-factor";

/** Erzeugt neue Wiederherstellungscodes; die alten verlieren dabei ihre Gueltigkeit. */
export async function POST(request: NextRequest) {
  const { admin, error } = await requireCurrentAdmin();
  if (error) return error;

  if (!isTwoFactorActive(admin)) {
    return NextResponse.json({ error: "Zwei-Faktor ist nicht aktiv" }, { status: 409 });
  }

  const body = await request.json().catch(() => ({}));
  if (!(await passwordMatches(admin, (body as { password?: unknown }).password))) {
    return wrongPassword();
  }

  const recoveryCodes = await replaceRecoveryCodes(admin.id);
  return NextResponse.json({ recoveryCodes });
}
