import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { clearRiderCookie, riderApiSession } from "@/lib/rider-auth";
import { riderAuthContext } from "@/lib/rider-auth-api";
import { FAMILY_INVITE_COOKIE } from "@/lib/rider-family-invite";
import { endOtherSessions } from "@/lib/rider-reset";

/**
 * POST: auf allen Geräten abmelden. Erhöht die `sessionVersion`: alle
 * Sitzungen dieses Zugangs enden, auch die auf diesem Gerät, und ältere
 * Anmelde-Links aus Mails melden nicht mehr an. Die Push-Abos des Profils
 * enden mit; nach dem neuen Anmelden lässt sich Push wieder einschalten.
 * Nur die Person selbst.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const ctx = await riderAuthContext(request, params, "logout-all");
  if ("error" in ctx) return ctx.error;
  const session = await riderApiSession(ctx.profile.token);
  if ("error" in session) return session.error;

  await endOtherSessions(session.profile.id);
  await prisma.riderPushSubscription.deleteMany({
    where: { profileId: session.profile.id, accountId: session.profile.accountId },
  });
  const res = clearRiderCookie(NextResponse.json({ ok: true }));
  res.cookies.delete(FAMILY_INVITE_COOKIE);
  return res;
}
