import { NextRequest, NextResponse } from "next/server";
import { publicRateLimit } from "./rate-limit";
import { findRiderAuthProfile, type RiderAuthProfile } from "./rider-auth";

/**
 * Gemeinsamer Einstieg der Anmelde-Schnittstellen: bremst je IP und je Link
 * und lädt das Profil zum Link.
 */
export async function riderAuthContext(
  request: NextRequest,
  params: Promise<{ token: string }>,
  scope: string,
): Promise<{ profile: RiderAuthProfile } | { error: NextResponse }> {
  const { token } = await params;
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const limited =
    publicRateLimit(ip, `rider-auth-ip-${scope}`, { limit: 30, windowMs: 10 * 60_000 }) ??
    publicRateLimit(token, `rider-auth-${scope}`, { limit: 20, windowMs: 10 * 60_000 });
  if (limited) return { error: limited };
  const profile = await findRiderAuthProfile(token);
  if (!profile) return { error: NextResponse.json({ error: "Nicht gefunden" }, { status: 404 }) };
  return { profile };
}

export const NOT_ALLOWED = () =>
  NextResponse.json({ error: "Bitte melde dich zuerst an." }, { status: 401 });
