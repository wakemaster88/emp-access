import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { AUTH_COOKIE, cookieValueForPin } from "@/lib/auth";
import { logEvent } from "@/lib/audit";

export const dynamic = "force-dynamic";

const COOKIE_MAX_AGE_SEC = 365 * 24 * 60 * 60; // Kiosk loggt sich einmal ein

export async function POST(req: Request) {
  let pin = "";
  try {
    const body = (await req.json()) as { pin?: string };
    if (typeof body.pin === "string") pin = body.pin;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const config = await loadConfig();
  const expected = config.settings.adminPin;
  if (!expected) {
    return NextResponse.json({ ok: true, note: "keine PIN konfiguriert" });
  }

  if (pin !== expected) {
    // Kleiner Brute-Force-Dämpfer
    await new Promise((r) => setTimeout(r, 750));
    await logEvent({
      action: "auth-login",
      ok: false,
      meta: { ip: req.headers.get("x-forwarded-for") ?? "?" },
    });
    return NextResponse.json({ error: "falsche PIN" }, { status: 401 });
  }

  await logEvent({ action: "auth-login", ok: true });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, cookieValueForPin(expected), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SEC,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
