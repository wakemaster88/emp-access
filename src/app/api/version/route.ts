import { NextResponse, type NextRequest } from "next/server";
import { BUILD_ID, BUILD_TIME } from "@/lib/app-version";
import { releaseNotesSince } from "@/lib/release-notes";

/**
 * Öffentlich und ohne Anmeldung: liefert die Build-ID des laufenden
 * Deployments (die Commits sind im öffentlichen Repo ohnehin sichtbar).
 * Der Update-Hinweis im Browser vergleicht sie mit seinem eigenen Stand.
 *
 * Mit `?seit=<Build-Zeit des Browsers>` kommen die Neuerungen dazu: Titel
 * der PRs, die seitdem gemergt und mit diesem Build ausgeliefert wurden.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const since = req.nextUrl.searchParams.get("seit");
  const body: { buildId: string; notes?: string[] } = { buildId: BUILD_ID };
  if (since) body.notes = await releaseNotesSince(since, BUILD_TIME);
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
