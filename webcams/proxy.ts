import { NextResponse, type NextRequest } from "next/server";
import { loadConfig } from "@/lib/config";
import { ADMIN_TOKEN_HEADER, AUTH_COOKIE, checkRequestAuth } from "@/lib/auth";

/**
 * Globales Auth-Gate (Next.js 16 Proxy, Node-Runtime).
 *
 * Wenn eine Admin-PIN konfiguriert ist, brauchen alle Seiten und API-Routen
 * entweder das Login-Cookie (Browser) oder den `x-admin-token`-Header
 * (Sidecar/Skripte). Ausgenommen sind nur Endpunkte mit eigenem Secret
 * (Doorbird-/Telegram-/emp-access-Webhooks) und der Login-Flow selbst.
 *
 * Besonders kritische Routen prüfen zusätzlich selbst via `requireAuth()`.
 */

const PUBLIC_PATHS = new Set(["/login", "/api/auth/login", "/api/go2rtc/status"]);

/** Webhooks von externen Geräten/Diensten — haben eigene Secrets. */
const WEBHOOK_PREFIXES = [
  "/api/doorbird/ring",
  "/api/telegram/webhook",
  "/api/emp-access/webhook",
];

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Statische Assets / interne Next-Pfade nie blockieren.
  if (
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/__nextjs")
  ) {
    return NextResponse.next();
  }

  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();
  if (WEBHOOK_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  let pin = "";
  try {
    pin = (await loadConfig()).settings.adminPin;
  } catch {
    // Config kaputt/nicht lesbar → lieber durchlassen als das ganze
    // Dashboard (lokales Kiosk-Setup) komplett zu blockieren.
    return NextResponse.next();
  }
  if (!pin) return NextResponse.next();

  const ok = checkRequestAuth({
    pin,
    cookieValue: req.cookies.get(AUTH_COOKIE)?.value ?? null,
    headerToken: req.headers.get(ADMIN_TOKEN_HEADER),
  });
  if (ok) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(loginUrl);
}