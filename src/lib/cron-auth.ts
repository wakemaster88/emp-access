import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

/**
 * Auth fuer die Vercel-Crons: `Authorization: Bearer <CRON_SECRET>`.
 * Eine Stelle fuer alle Cron-Routen, mit zeitkonstantem Vergleich.
 */
export function verifyCronAuth(
  request: NextRequest,
): { ok: true } | { ok: false; status: number; body: object } {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return {
      ok: false,
      status: 503,
      body: {
        error: "CRON_SECRET ist nicht gesetzt",
        hint: "In Vercel: Projekt → Settings → Environment Variables → CRON_SECRET (min. 16 Zeichen). Nach dem Anlegen neu deployen.",
      },
    };
  }
  const auth = request.headers.get("authorization")?.trim();
  const bearer = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  if (!bearer || !secretsEqual(bearer, secret)) {
    return {
      ok: false,
      status: 401,
      body: {
        error: "Unauthorized",
        hint: "Vercel sendet Authorization: Bearer <CRON_SECRET>. Wert in Vercel muss exakt mit CRON_SECRET übereinstimmen.",
      },
    };
  }
  return { ok: true };
}

/** Zeitkonstanter Vergleich zweier Geheimnisse (auch bei ungleicher Laenge). */
export function secretsEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
