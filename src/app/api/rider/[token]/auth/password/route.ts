import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  checkRiderPassword, hasCredential, hashRiderPassword, mayManageCredentials, resetRiderLoginLocks, riderPasswordLimitResponse,
  setRiderCookie,
} from "@/lib/rider-auth";
import { NOT_ALLOWED, riderAuthContext } from "@/lib/rider-auth-api";
import { endOtherSessions, riderResetKeyValid } from "@/lib/rider-reset";
import { riderPasswordError } from "@/lib/rider-session";

/**
 * POST: Passwort setzen. Beim Einrichten reicht der Einladungslink, später
 * braucht es die Sitzung und (falls schon eines gesetzt ist) das bisherige Passwort.
 * Mit dem Schlüssel aus der Mail „Passwort vergessen“ (`resetKey`) geht es ohne
 * beides. Nach jedem Wechsel des Passworts enden alle anderen Sitzungen; dieses
 * Gerät bleibt angemeldet.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const ctx = await riderAuthContext(request, params, "password");
  if ("error" in ctx) return ctx.error;
  const { profile } = ctx;
  const body = (await request.json().catch(() => null)) as { password?: unknown; current?: unknown; resetKey?: unknown } | null;
  const viaReset = body?.resetKey != null && riderResetKeyValid(profile, body.resetKey);
  if (body?.resetKey != null && !viaReset) {
    return NextResponse.json({ error: "Dieser Link gilt nicht mehr. Fordere auf der Anmeldeseite einen neuen an." }, { status: 401 });
  }
  if (!viaReset && !(await mayManageCredentials(profile))) return NOT_ALLOWED();

  const problem = riderPasswordError(body?.password);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  if (!viaReset && hasCredential(profile) && profile.passwordHash) {
    const check = await checkRiderPassword(profile, body?.current, ctx.ip);
    if (check === "locked" || check === "slow") return riderPasswordLimitResponse(check);
    if (check !== "ok") return NextResponse.json({ error: "Das bisherige Passwort stimmt nicht." }, { status: 400 });
  }

  await prisma.riderProfile.update({
    where: { id: profile.id },
    data: { passwordHash: await hashRiderPassword(body!.password as string), loginFailures: 0, loginLockedUntil: null },
  });
  await resetRiderLoginLocks(profile.id);
  // Passwort geändert (oder per Mail neu festgelegt): alle anderen Geräte
  // werden abgemeldet, dieses bekommt ein neues Cookie. Das erste Passwort
  // (auch neben einem Passkey) lässt die übrigen Sitzungen stehen.
  const sessionVersion = viaReset || profile.passwordHash != null ? await endOtherSessions(profile.id) : profile.sessionVersion;
  return setRiderCookie(NextResponse.json({ ok: true }), { id: profile.id, sessionVersion });
}
