import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { gamiAdminSession } from "@/lib/gamification-session";

const schema = z.object({ hidden: z.boolean() });

/**
 * PATCH: Foto einer Foto-Challenge aus- oder wieder einblenden. Ausgeblendet
 * sieht es nur noch die Person selbst, und es zählt nicht mit. Nach der
 * Auswertung stehen die Gewinner fest; ein Ausblenden ändert sie nicht mehr.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await gamiAdminSession();
  if ("error" in session) return session.error;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });

  const entry = await session.db.challengeEntry.findFirst({ where: { id, accountId: session.accountId }, select: { id: true } });
  if (!entry) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  await session.db.challengeEntry.update({ where: { id }, data: { hidden: parsed.data.hidden } });
  return NextResponse.json({ ok: true });
}
