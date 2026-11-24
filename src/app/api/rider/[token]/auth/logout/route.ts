import { NextResponse } from "next/server";
import { clearRiderCookie } from "@/lib/rider-auth";
import { FAMILY_INVITE_COOKIE } from "@/lib/rider-family-invite";

/** POST: abmelden (Cookie löschen). Eine wartende Familien-Einladung geht mit. */
export async function POST() {
  const res = clearRiderCookie(NextResponse.json({ ok: true }));
  res.cookies.delete(FAMILY_INVITE_COOKIE);
  return res;
}
