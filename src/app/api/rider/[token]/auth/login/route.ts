import { NextRequest, NextResponse } from "next/server";
import { checkRiderPassword, riderPasswordLimitResponse, setRiderCookie } from "@/lib/rider-auth";
import { riderAuthContext } from "@/lib/rider-auth-api";

/** POST: Anmeldung mit Passwort. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const ctx = await riderAuthContext(request, params, "login");
  if ("error" in ctx) return ctx.error;
  const { profile } = ctx;

  const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
  const check = await checkRiderPassword(profile, body?.password, ctx.ip);
  if (check === "locked" || check === "slow") return riderPasswordLimitResponse(check);
  if (check !== "ok") return NextResponse.json({ error: "Das Passwort stimmt nicht." }, { status: 401 });
  return setRiderCookie(NextResponse.json({ ok: true }), profile);
}
