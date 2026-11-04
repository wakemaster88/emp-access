import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { findSimilarUnknown, SEARCH_PRESELECT } from "@/lib/person-profile";

/** GET (Session): unbekannte Sichtungen, die dieser Person aehneln. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  try {
    const result = await findSimilarUnknown(session.accountId!, id);
    return NextResponse.json({ ...result, preselect: SEARCH_PRESELECT });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Fehler" }, { status: 404 });
  }
}
