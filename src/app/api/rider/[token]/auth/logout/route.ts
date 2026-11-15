import { NextResponse } from "next/server";
import { clearRiderCookie } from "@/lib/rider-auth";

/** POST: abmelden (Cookie löschen). */
export async function POST() {
  return clearRiderCookie(NextResponse.json({ ok: true }));
}
