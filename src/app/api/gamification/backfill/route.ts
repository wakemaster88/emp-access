import { NextResponse } from "next/server";
import { gamiAdminSession } from "@/lib/gamification-session";
import { backfillYear } from "@/lib/gamification-service";
import { berlinYmd } from "@/lib/berlin-day";

/** Laufzeitlimit der Route auf Vercel in Sekunden (gleicher Wert wie in vercel.json). */
export const maxDuration = 60;

/**
 * POST: Tagessummen des laufenden Jahres aus den vorhandenen Scans neu
 * berechnen. Nur das laufende Jahr, weil ältere Scans den Löschfristen
 * unterliegen und eine Neuberechnung sonst Tage verlieren würde.
 */
export async function POST() {
  const session = await gamiAdminSession();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const year = Number(berlinYmd(new Date()).slice(0, 4));
  const result = await backfillYear(db, accountId, year);
  return NextResponse.json({ year, ...result });
}
