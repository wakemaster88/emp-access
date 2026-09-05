import { NextRequest, NextResponse } from "next/server";
import { compare } from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { clearLoginThrottle, hitLoginThrottle } from "@/lib/login-throttle";
import { isTwoFactorActive, isTwoFactorLocked } from "@/lib/two-factor";
import {
  DUMMY_PASSWORD_HASH,
  isLoginLocked,
  loginRetryAfterSec,
  registerLoginFailure,
} from "@/lib/login-lockout";

/**
 * Sagt dem Login-Formular nach der Passworteingabe, ob noch ein zweiter Faktor
 * verlangt wird. Geprueft – und damit verbraucht – wird der Code selbst erst
 * in authorize() (src/lib/auth.ts).
 *
 * Die Antwort verraet nichts, was ein Angreifer nicht ohnehin am regulaeren
 * Login ablesen koennte: ob das Passwort stimmt, sieht er dort genauso.
 *
 * Zwei Bremsen: die In-Memory-Bremse pro Instanz (IP + E-Mail) und die
 * Sperre am Admin-Datensatz nach zu vielen falschen Passwoertern.
 */

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function clientKey(request: NextRequest, email: string): string {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  return `${ip}|${email.toLowerCase()}`;
}

function lockedResponse(retryAfterSec: number) {
  const minutes = Math.max(1, Math.ceil(retryAfterSec / 60));
  return NextResponse.json(
    {
      error: `Konto vorübergehend gesperrt. Bitte in ${minutes} Minute${minutes === 1 ? "" : "n"} erneut versuchen.`,
      locked: true,
      retryAfterSec,
    },
    { status: 423, headers: { "Retry-After": String(retryAfterSec) } },
  );
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }

  const throttle = hitLoginThrottle(clientKey(request, parsed.data.email));
  if (!throttle.allowed) {
    return NextResponse.json(
      { error: "Zu viele Anmeldeversuche. Bitte später erneut versuchen.", retryAfterSec: throttle.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(throttle.retryAfterSec) } }
    );
  }

  const admin = await prisma.admin.findUnique({
    where: { email: parsed.data.email },
    select: {
      id: true,
      password: true,
      loginFailures: true,
      loginLockedUntil: true,
      twoFactorSecret: true,
      twoFactorEnabledAt: true,
      twoFactorLockedUntil: true,
    },
  });

  const now = new Date();
  if (admin && isLoginLocked(admin, now)) {
    return lockedResponse(loginRetryAfterSec(admin, now));
  }

  const valid = await compare(parsed.data.password, admin?.password ?? DUMMY_PASSWORD_HASH);
  if (!admin || !valid) {
    if (admin) await registerLoginFailure(admin, now);
    return NextResponse.json({ ok: false });
  }

  if (!isTwoFactorActive(admin)) {
    clearLoginThrottle(clientKey(request, parsed.data.email));
    return NextResponse.json({ ok: true, twoFactor: false });
  }

  if (isTwoFactorLocked(admin, now)) {
    return NextResponse.json({
      ok: true,
      twoFactor: true,
      locked: true,
      retryAfterSec: Math.ceil((admin.twoFactorLockedUntil!.getTime() - now.getTime()) / 1000),
    });
  }

  return NextResponse.json({ ok: true, twoFactor: true, locked: false });
}
