import { NextResponse } from "next/server";
import { BUILD_ID } from "@/lib/app-version";

/**
 * Öffentlich und ohne Anmeldung: liefert nur die Build-ID des laufenden
 * Deployments (die Commits sind im öffentlichen Repo ohnehin sichtbar).
 * Der Update-Hinweis im Browser vergleicht sie mit seinem eigenen Stand.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ buildId: BUILD_ID }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
