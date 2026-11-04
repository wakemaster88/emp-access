import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { optimizePersonProfile } from "@/lib/person-profile";

/** POST (Session): Erkennungsprofil aus Samples + zugeordneten Sichtungen neu waehlen. */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  try {
    return NextResponse.json(await optimizePersonProfile(session.accountId!, id));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Fehler" }, { status: 404 });
  }
}
