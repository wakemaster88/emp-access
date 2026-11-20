import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { gamiAdminSession } from "@/lib/gamification-session";
import { inviteStatus } from "@/lib/rider-invite";

const schema = z.object({
  inviteNewAbos: z.boolean().optional(),
  inviteExistingAbos: z.boolean().optional(),
});

/** PUT: Einladung zur App bei neuem Abo bzw. an Bestandskunden ein- oder ausschalten. */
export async function PUT(request: NextRequest) {
  const session = await gamiAdminSession();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });
  }
  await db.gamificationConfig.upsert({
    where: { accountId },
    create: { ...parsed.data, accountId },
    update: parsed.data,
  });
  return NextResponse.json({ ok: true, status: await inviteStatus(accountId) });
}
