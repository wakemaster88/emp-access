import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { passwordMatches, requireCurrentAdmin, secondFactorProblem, wrongPassword } from "@/lib/account-security";
import { MAX_PASSKEYS_PER_ADMIN, createRegistrationOptions, relyingPartyFrom } from "@/lib/passkey";

/**
 * Startet das Anlegen eines Passkeys. Verlangt das Passwort und, solange 2FA
 * aktiv ist, einen gueltigen zweiten Faktor: Eine uebernommene Sitzung allein
 * soll keinen dauerhaften Zugang hinterlegen.
 */
export async function POST(request: NextRequest) {
  const { admin, error } = await requireCurrentAdmin();
  if (error) return error;

  const body = (await request.json().catch(() => null)) as { password?: unknown; code?: unknown } | null;
  if (!(await passwordMatches(admin, body?.password))) return wrongPassword();
  // Volles Kontingent vor dem zweiten Faktor pruefen: sonst waere ein
  // eingegebener Code (oder Wiederherstellungscode) verbraucht, ohne dass ein
  // Passkey entstehen kann.
  const tooMany = () =>
    NextResponse.json(
      { error: `Höchstens ${MAX_PASSKEYS_PER_ADMIN} Passkeys je Konto. Bitte zuerst einen alten löschen.` },
      { status: 409 },
    );
  if ((await prisma.passkey.count({ where: { adminId: admin.id } })) >= MAX_PASSKEYS_PER_ADMIN) return tooMany();
  const secondProblem = await secondFactorProblem(admin, body?.code);
  if (secondProblem) return secondProblem;

  const options = await createRegistrationOptions(relyingPartyFrom(request.headers), admin);
  if (!options) return tooMany();
  return NextResponse.json(options, { headers: { "Cache-Control": "no-store" } });
}
