import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getSessionWithDb } from "@/lib/api-auth";

/**
 * Erzeugt (oder rotiert) den Mobile-PWA-Token eines Mitarbeiters.
 *
 * Sicherheit:
 *   - Wir generieren 32 Bytes (-> 64 hex) Zufallsdaten, damit Brute-Force
 *     auf den oeffentlichen `/m/<token>`-Endpoint nicht praktikabel ist.
 *   - Bestehende Tokens werden ersetzt; ein parallel installierter Home-
 *     Bildschirm-Shortcut wird damit ungueltig (gewuenscht, falls jemand
 *     den Mitarbeiter verlassen hat).
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const { id } = await params;
  const employeeId = Number(id);
  if (Number.isNaN(employeeId)) {
    return NextResponse.json({ error: "Ungueltige ID" }, { status: 400 });
  }

  const employee = await db.ticket.findFirst({
    where: { id: employeeId, accountId: accountId!, source: "EMP_CONTROL" },
    select: { id: true },
  });
  if (!employee) return NextResponse.json({ error: "Mitarbeiter nicht gefunden" }, { status: 404 });

  const token = randomBytes(32).toString("hex");
  await db.ticket.update({
    where: { id: employeeId },
    data: { mobileToken: token },
  });

  return NextResponse.json({ token });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const { id } = await params;
  const employeeId = Number(id);
  if (Number.isNaN(employeeId)) {
    return NextResponse.json({ error: "Ungueltige ID" }, { status: 400 });
  }

  const employee = await db.ticket.findFirst({
    where: { id: employeeId, accountId: accountId!, source: "EMP_CONTROL" },
    select: { id: true },
  });
  if (!employee) return NextResponse.json({ error: "Mitarbeiter nicht gefunden" }, { status: 404 });

  await db.ticket.update({
    where: { id: employeeId },
    data: { mobileToken: null },
  });

  return NextResponse.json({ ok: true });
}
