import { NextRequest, NextResponse } from "next/server";
import { publicRateLimit } from "./rate-limit";
import { findRiderAuthProfile, type RiderAuthProfile } from "./rider-auth";

/**
 * Scopes mit Passwort-Prüfung: Die Sperre je (Profil, IP) und die Bremse über
 * alle IPs liegen in der Datenbank (`checkRiderPassword`). Im Speicher zählt
 * hier je (Link, IP), damit Anfragen von fremden Anschlüssen die Person selbst
 * nicht ausbremsen; je IP gilt eine höhere Grenze (Gast-WLAN am Gelände).
 */
const PASSWORD_SCOPES = new Set(["login", "password"]);

/**
 * Gemeinsamer Einstieg der Anmelde-Schnittstellen: bremst je IP und je Link
 * und lädt das Profil zum Link. Liefert auch die Client-IP (Passwort-Sperre).
 */
export async function riderAuthContext(
  request: NextRequest,
  params: Promise<{ token: string }>,
  scope: string,
): Promise<{ profile: RiderAuthProfile; ip: string } | { error: NextResponse }> {
  const { token } = await params;
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const password = PASSWORD_SCOPES.has(scope);
  const limited =
    publicRateLimit(ip, `rider-auth-ip-${scope}`, { limit: password ? 300 : 30, windowMs: 10 * 60_000 }) ??
    publicRateLimit(password ? `${token}|${ip}` : token, `rider-auth-${scope}`, { limit: 20, windowMs: 10 * 60_000 });
  if (limited) return { error: limited };
  const profile = await findRiderAuthProfile(token);
  if (!profile) return { error: NextResponse.json({ error: "Nicht gefunden" }, { status: 404 }) };
  return { profile, ip };
}

export const NOT_ALLOWED = () =>
  NextResponse.json({ error: "Bitte melde dich zuerst an." }, { status: 401 });
