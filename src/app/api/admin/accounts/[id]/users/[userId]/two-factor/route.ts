import { NextRequest, NextResponse } from "next/server";
import { safeAuth } from "@/lib/auth";
import { superAdminClient } from "@/lib/prisma";
import { disableTwoFactor } from "@/lib/two-factor";

/**
 * Notausgang, wenn ein Benutzer sein Handy verloren hat und keine
 * Wiederherstellungscodes mehr besitzt: der SUPER_ADMIN setzt den zweiten
 * Faktor zurueck. Danach kommt der Benutzer wieder mit Passwort allein hinein
 * und sollte 2FA umgehend neu einrichten.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  const session = await safeAuth();
  if (!session?.user || session.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id, userId } = await params;
  const accountId = parseInt(id, 10);
  const adminId = parseInt(userId, 10);
  if (isNaN(accountId) || isNaN(adminId)) {
    return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  }

  const existing = await superAdminClient.admin.findFirst({
    where: { id: adminId, accountId },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Benutzer nicht gefunden" }, { status: 404 });

  await disableTwoFactor(existing.id);

  return NextResponse.json({ success: true });
}
