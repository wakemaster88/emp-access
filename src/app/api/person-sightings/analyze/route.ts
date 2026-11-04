import { NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { queueFaceAnalysis } from "@/lib/unknown-persons";

/** POST (Session): Hub analysiert noch nicht ausgewertete Bilder unbekannter Sichtungen. */
export async function POST() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  return NextResponse.json(await queueFaceAnalysis(session.accountId!));
}
