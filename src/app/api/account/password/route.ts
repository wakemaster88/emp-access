import { NextRequest, NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { passwordMatches, requireCurrentAdmin, wrongPassword } from "@/lib/account-security";
import { isTwoFactorActive, verifySecondFactor } from "@/lib/two-factor";
import { passwordProblem } from "@/lib/password-rules";
import { resetLoginLocks } from "@/lib/login-lockout";

/**
 * Eigenes Passwort aendern – fuer jede Rolle, auch fuer den SUPER_ADMIN, der
 * in der Benutzerverwaltung der Mandanten nicht vorkommt.
 *
 * Verlangt das aktuelle Passwort und, solange 2FA aktiv ist, einen gueltigen
 * zweiten Faktor: Eine uebernommene Sitzung allein darf das Konto nicht
 * uebernehmen koennen. Danach steigt `sessionVersion` – alle Sitzungen dieses
 * Kontos (auch die eigene) enden bei ihrer naechsten Pruefung, die Oberflaeche
 * meldet deshalb sofort ab.
 */
export async function POST(request: NextRequest) {
  const { admin, error } = await requireCurrentAdmin();
  if (error) return error;

  const body = (await request.json().catch(() => ({}))) as {
    currentPassword?: unknown;
    newPassword?: unknown;
    code?: unknown;
  };

  const problem = passwordProblem(body.newPassword, { email: admin.email });
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  const newPassword = body.newPassword as string;

  if (!(await passwordMatches(admin, body.currentPassword))) return wrongPassword();

  if (newPassword === body.currentPassword) {
    return NextResponse.json({ error: "Das neue Passwort muss sich vom bisherigen unterscheiden" }, { status: 400 });
  }

  if (isTwoFactorActive(admin)) {
    const second = await verifySecondFactor(admin, typeof body.code === "string" ? body.code : "");
    if (!second.ok) {
      const message =
        second.reason === "locked"
          ? "Zu viele Fehlversuche. Bitte später erneut versuchen."
          : second.reason === "missing"
            ? "Bitte den Code aus der Authenticator-App eingeben"
            : "Code ungültig oder abgelaufen";
      // `needsCode`: Die Karte kennt den 2FA-Zustand nur vom Laden der Seite.
      // Wurde 2FA seitdem eingeschaltet, blendet sie das Code-Feld hierauf ein.
      return NextResponse.json({ error: message, needsCode: true }, { status: 400 });
    }
  }

  await prisma.admin.update({
    where: { id: admin.id },
    data: {
      password: await hash(newPassword, 12),
      sessionVersion: { increment: 1 },
      loginFailures: 0,
      loginLockedUntil: null,
    },
  });
  // Sperren aus alten Fehlversuchen entfallen mit dem neuen Passwort.
  await resetLoginLocks(admin.email);

  return NextResponse.json({ success: true });
}
