import { NextResponse } from "next/server";
import { compare } from "bcryptjs";
import { prisma } from "./prisma";
import { safeAuth } from "./auth";
import { isTwoFactorActive, twoFactorSelect, verifySecondFactor, type TwoFactorFields } from "./two-factor";
import { clearLoginThrottle, hitLoginThrottle } from "./login-throttle";

/**
 * Gemeinsamer Unterbau der Routen unter /api/account – sie arbeiten immer auf
 * dem eigenen Konto, nie auf einem fremden.
 */

export type CurrentAdmin = TwoFactorFields & { email: string; name: string; password: string };

export async function requireCurrentAdmin(): Promise<
  { admin: CurrentAdmin; error?: never } | { admin?: never; error: NextResponse }
> {
  const session = await safeAuth();
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 }) };
  }

  const adminId = parseInt(session.user.id, 10);
  if (isNaN(adminId)) {
    return { error: NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 }) };
  }

  const admin = await prisma.admin.findUnique({
    where: { id: adminId },
    select: { ...twoFactorSelect, email: true, name: true, password: true },
  });
  if (!admin) {
    return { error: NextResponse.json({ error: "Konto nicht gefunden" }, { status: 401 }) };
  }

  return { admin };
}

/**
 * Sicherheitsrelevante Aenderungen verlangen das Passwort. Eine uebernommene
 * Sitzung allein soll nicht reichen, um den zweiten Faktor umzuhaengen oder
 * abzuschalten.
 *
 * Bremse gegen Durchprobieren aus einer uebernommenen Sitzung: je Konto und
 * Instanz hoechstens 20 Abfragen in 10 Minuten (login-throttle.ts). Bewusst
 * NICHT an die Anmelde-Sperre gekoppelt – die kann jeder von aussen mit
 * falschen Passwoertern ausloesen, und dann kaeme der angemeldete Besitzer
 * hier nicht mehr an seine eigenen Sicherheitseinstellungen.
 */
export async function passwordMatches(admin: CurrentAdmin, password: unknown): Promise<boolean> {
  if (typeof password !== "string" || password.length === 0) return false;
  const key = `account-password|${admin.id}`;
  if (!hitLoginThrottle(key).allowed) return false;
  const valid = await compare(password, admin.password);
  // Nur falsche Eingaben sollen sich aufsummieren: wer sein Passwort kennt,
  // darf mehrere Aenderungen hintereinander bestaetigen.
  if (valid) clearLoginThrottle(key);
  return valid;
}

export function wrongPassword() {
  return NextResponse.json({ error: "Passwort ist falsch" }, { status: 403 });
}

/**
 * Bei aktivem 2FA zusaetzlich einen gueltigen zweiten Faktor verlangen
 * (TOTP-Code oder Wiederherstellungscode). Gibt die Fehlerantwort zurueck
 * oder null, wenn alles passt bzw. 2FA nicht aktiv ist. `needsCode` sagt der
 * Oberflaeche, dass sie das Code-Feld zeigen soll – sie kennt den 2FA-Zustand
 * nur vom Laden der Seite.
 */
export async function secondFactorProblem(admin: CurrentAdmin, code: unknown): Promise<NextResponse | null> {
  if (!isTwoFactorActive(admin)) return null;
  const second = await verifySecondFactor(admin, typeof code === "string" ? code : "");
  if (second.ok) return null;
  const message =
    second.reason === "locked"
      ? "Zu viele Fehlversuche. Bitte später erneut versuchen."
      : second.reason === "missing"
        ? "Bitte den Code aus der Authenticator-App eingeben"
        : "Code ungültig oder abgelaufen. Ein Code gilt nur einmal – nach der Anmeldung bitte auf den nächsten Code warten.";
  return NextResponse.json({ error: message, needsCode: true }, { status: 400 });
}
