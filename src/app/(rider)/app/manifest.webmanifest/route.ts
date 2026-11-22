import { NextResponse } from "next/server";
import { riderAppKind } from "@/lib/rider-base";
import { APP_PREFIX, riderManifest } from "@/lib/rider-app-kind";

/**
 * Allgemeines Manifest der Kunden-App für `/app` bzw. `/beach` (Anmeldung).
 * Vorher galt dort das Verwaltungs-Manifest („EMP Access“, Start auf `/`):
 * Wer die App von der Startseite aus zum Home-Bildschirm hinzufügte, landete
 * in der Verwaltung. Unter `/app/<token>` gilt weiter das persönliche.
 */
export async function GET() {
  const kind = await riderAppKind();
  return NextResponse.json(riderManifest(kind, APP_PREFIX[kind]), {
    headers: { "Content-Type": "application/manifest+json; charset=utf-8", "Cache-Control": "private, max-age=3600" },
  });
}
