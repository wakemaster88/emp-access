import { NextRequest, NextResponse } from "next/server";
import { getAccountFromRequest } from "@/lib/api-auth";
import { fetchAudioLibrary } from "@/lib/audio-integration";

/**
 * Playlists und Musikstücke für die Quellenwahl in emp-control.
 * Auth: Admin-Session oder Account-API-Token.
 */
export async function GET(request: NextRequest) {
  const auth = await getAccountFromRequest(request);
  if ("error" in auth) return auth.error;

  const library = await fetchAudioLibrary(auth.db, auth.accountId);
  return NextResponse.json(library);
}
