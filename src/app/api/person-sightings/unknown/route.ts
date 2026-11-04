import { NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { getUnknownOverview } from "@/lib/unknown-persons";

/** GET (Session): unbekannte Sichtungen, nach Gesicht gruppiert, mit Vorschlaegen. */
export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  return NextResponse.json(await getUnknownOverview(session.accountId!));
}
