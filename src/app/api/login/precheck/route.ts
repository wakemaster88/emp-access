import { NextRequest, NextResponse } from "next/server";
import { compare } from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { clearLoginThrottle, hitLoginThrottle } from "@/lib/login-throttle";
import { isTwoFactorActive, isTwoFactorLocked } from "@/lib/two-factor";

/**
 * Sagt dem Login-Formular nach der Passworteingabe, ob noch ein zweiter Faktor
 * verlangt wird. Geprueft – und damit verbraucht – wird der Code selbst erst
 * in authorize() (src/lib/auth.ts).
 *
 * Die Antwort verraet nichts, was ein Angreifer nicht ohnehin am regulaeren
 * Login ablesen koennte: ob das Passwort stimmt, sieht er dort genauso.
 */

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Damit ein unbekanntes Konto nicht spuerbar schneller antwortet als ein
// bekanntes, laeuft auch dann ein echter bcrypt-Vergleich (gegen ein Passwort,
// das niemand kennt) mit denselben Kosten wie ein regulaerer Login.
const DUMMY_HASH = "$2b$12$tPNA94P44gf5rC3TNFFr/OMt4HF6aef5QS33gm5HpP6V43cURutca";

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
      password: true,
      twoFactorSecret: true,
      twoFactorEnabledAt: true,
      twoFactorLockedUntil: true,
    },
  });

  const valid = await compare(parsed.data.password, admin?.password ?? DUMMY_HASH);
  if (!admin || !valid) {
    return NextResponse.json({ ok: false });
  }

  if (!isTwoFactorActive(admin)) {
    clearLoginThrottle(clientKey(request, parsed.data.email));
    return NextResponse.json({ ok: true, twoFactor: false });
  }

  const now = new Date();
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
