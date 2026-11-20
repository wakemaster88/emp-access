import { NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import type { Actor } from "@/lib/venue-events";

/**
 * Sitzung fuer die Veranstaltungs-Endpunkte im Backoffice. Termine sehen und
 * pflegen darf jedes Team-Konto; Partner-Zugaenge, Preise, Raeume und
 * Dokumente nur Admins (`requireAdmin`).
 */
export async function venueSession(options: { requireAdmin?: boolean } = {}) {
  const s = await getSessionWithDb(options);
  if ("error" in s) return { error: s.error };
  if (s.accountId == null) return { error: NextResponse.json({ error: "Kein Mandant" }, { status: 403 }) };
  const actor: Actor = { by: "ADMIN", name: s.session.user.name?.slice(0, 120) || null };
  return { accountId: s.accountId, actor };
}

export function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}
