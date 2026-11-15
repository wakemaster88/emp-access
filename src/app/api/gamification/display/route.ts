import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { gamiAdminSession } from "@/lib/gamification-session";

/** POST: öffentliche Rangliste einschalten (oder den vorhandenen Link liefern). */
export async function POST() {
  const session = await gamiAdminSession();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const existing = await db.gamificationConfig.findUnique({ where: { accountId }, select: { displayToken: true } });
  const token = existing?.displayToken ?? randomBytes(18).toString("base64url");
  if (!existing?.displayToken) {
    await db.gamificationConfig.upsert({
      where: { accountId },
      create: { displayToken: token, accountId },
      update: { displayToken: token },
    });
  }
  return NextResponse.json({ path: `/rangliste/${token}` });
}

/** DELETE: öffentliche Rangliste abschalten; der alte Link gilt danach nicht mehr. */
export async function DELETE() {
  const session = await gamiAdminSession();
  if ("error" in session) return session.error;
  await session.db.gamificationConfig.updateMany({
    where: { accountId: session.accountId },
    data: { displayToken: null },
  });
  return NextResponse.json({ ok: true });
}
