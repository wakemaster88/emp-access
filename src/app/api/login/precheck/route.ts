import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { clearLoginThrottle, hitLoginThrottle } from "@/lib/login-throttle";
import { isTwoFactorActive, isTwoFactorLocked } from "@/lib/two-factor";
import { checkLoginPassword, clearLoginFailures } from "@/lib/login-lockout";
import { requestClientIp } from "@/lib/rate-limit";

/**
 * Sagt dem Login-Formular nach der Passworteingabe, ob noch ein zweiter Faktor
 * verlangt wird. Geprueft – und damit verbraucht – wird der Code selbst erst
 * in authorize() (src/lib/auth.ts).
 *
 * Die Antwort verraet nichts, was ein Angreifer nicht ohnehin am regulaeren
 * Login ablesen koennte: ob das Passwort stimmt, sieht er dort genauso.
 *
 * Zwei Bremsen: die In-Memory-Bremse pro Instanz (IP + E-Mail) und die
 * Sperre je (E-Mail, Client-IP) nach zu vielen falschen Passwoertern; ueber
 * alle IPs zusammen wird nur verlangsamt und getaktet (login-lockout.ts). Gesperrt,
 * unbekannte E-Mail und falsches Passwort ergeben dieselbe Antwort
 * `{ ok: false }` – ob es ein Konto gibt oder ob es gesperrt ist, ist daran
 * nicht abzulesen.
 */

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function clientKey(request: NextRequest, email: string): string {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  return `${ip}|${email.toLowerCase()}`;
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
      twoFactorSecret: true,
      twoFactorEnabledAt: true,
      twoFactorLockedUntil: true,
    },
  });

  const now = new Date();
  const { valid, key } = await checkLoginPassword(
    admin,
    parsed.data.email,
    parsed.data.password,
    requestClientIp(request.headers),
    now,
  );
  if (!admin || !valid) {
    return NextResponse.json({ ok: false });
  }
  // Richtiges Passwort: der belegte Versuch zaehlt nicht als Fehlversuch.
  await clearLoginFailures(key, now);

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
