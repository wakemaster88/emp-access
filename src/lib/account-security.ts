import { NextResponse } from "next/server";
import { compare } from "bcryptjs";
import { prisma } from "./prisma";
import { safeAuth } from "./auth";
import { twoFactorSelect, type TwoFactorFields } from "./two-factor";

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
 */
export async function passwordMatches(admin: CurrentAdmin, password: unknown): Promise<boolean> {
  if (typeof password !== "string" || password.length === 0) return false;
  return compare(password, admin.password);
}

export function wrongPassword() {
  return NextResponse.json({ error: "Passwort ist falsch" }, { status: 403 });
}
