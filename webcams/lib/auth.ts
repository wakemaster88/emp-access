import { createHmac, timingSafeEqual } from "node:crypto";
import { loadConfig } from "./config";

/**
 * PIN-basierte Auth für Admin-UI und kritische API-Routen.
 *
 * - Browser: Login auf `/login` setzt ein httpOnly-Cookie (`webcams_auth`),
 *   dessen Wert ein HMAC über eine feste Nachricht mit der PIN als Key ist.
 *   PIN-Änderung invalidiert damit automatisch alle bestehenden Sessions.
 * - Maschinen (Sidecar, Skripte): Header `x-admin-token: <PIN>`.
 * - Keine PIN konfiguriert → alles offen (Verhalten wie bisher; bewusst,
 *   damit man sich auf dem Kiosk nicht selbst aussperrt).
 */

export const AUTH_COOKIE = "webcams_auth";
export const ADMIN_TOKEN_HEADER = "x-admin-token";
const COOKIE_MESSAGE = "webcams-admin-v1";

export function cookieValueForPin(pin: string): string {
  return createHmac("sha256", pin).update(COOKIE_MESSAGE).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function checkRequestAuth(opts: {
  pin: string;
  cookieValue?: string | null;
  headerToken?: string | null;
}): boolean {
  const { pin, cookieValue, headerToken } = opts;
  if (!pin) return true;
  if (headerToken && safeEqual(headerToken, pin)) return true;
  if (cookieValue && safeEqual(cookieValue, cookieValueForPin(pin))) return true;
  return false;
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=") || null;
  }
  return null;
}

/**
 * Header für Next→Sidecar-Aufrufe. Der Sidecar verlangt bei gesetzter
 * Admin-PIN denselben Token (Shared Secret via gemeinsamer config.json).
 */
export async function sidecarAuthHeaders(): Promise<Record<string, string>> {
  const pin = (await loadConfig()).settings.adminPin;
  return pin ? { [ADMIN_TOKEN_HEADER]: pin } : {};
}

/**
 * Explizite Prüfung in besonders kritischen Route-Handlern
 * (Defense-in-Depth zusätzlich zum globalen `proxy.ts`-Gate).
 * Gibt `null` zurück wenn erlaubt, sonst eine fertige 401-Response.
 */
export async function requireAuth(req: Request): Promise<Response | null> {
  const config = await loadConfig();
  const ok = checkRequestAuth({
    pin: config.settings.adminPin,
    cookieValue: readCookie(req.headers.get("cookie"), AUTH_COOKIE),
    headerToken: req.headers.get(ADMIN_TOKEN_HEADER),
  });
  if (ok) return null;
  return Response.json({ error: "unauthorized" }, { status: 401 });
}
