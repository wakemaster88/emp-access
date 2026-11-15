import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  checkRiderPassword, hasCredential, hashRiderPassword, mayManageCredentials, setRiderCookie,
} from "@/lib/rider-auth";
import { NOT_ALLOWED, riderAuthContext } from "@/lib/rider-auth-api";
import { riderPasswordError } from "@/lib/rider-session";

/**
 * POST: Passwort setzen. Beim Einrichten reicht der Einladungslink, später
 * braucht es die Sitzung und (falls schon eines gesetzt ist) das bisherige Passwort.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const ctx = await riderAuthContext(request, params, "password");
  if ("error" in ctx) return ctx.error;
  const { profile } = ctx;
  if (!(await mayManageCredentials(profile))) return NOT_ALLOWED();

  const body = (await request.json().catch(() => null)) as { password?: unknown; current?: unknown } | null;
  const problem = riderPasswordError(body?.password);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  if (hasCredential(profile) && profile.passwordHash) {
    const check = await checkRiderPassword(profile, body?.current);
    if (check === "locked") {
      return NextResponse.json({ error: "Zu viele Versuche. Bitte in 15 Minuten noch einmal." }, { status: 429 });
    }
    if (check !== "ok") return NextResponse.json({ error: "Das bisherige Passwort stimmt nicht." }, { status: 400 });
  }

  await prisma.riderProfile.update({
    where: { id: profile.id },
    data: { passwordHash: await hashRiderPassword(body!.password as string), loginFailures: 0, loginLockedUntil: null },
  });
  return setRiderCookie(NextResponse.json({ ok: true }), profile);
}
