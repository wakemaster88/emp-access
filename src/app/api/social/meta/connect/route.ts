import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { newsletterAdmin } from "@/lib/newsletter/admin-auth";
import { metaAuthorizeUrl, metaConfig, metaRedirectUri } from "@/lib/social/meta";
import { metaOrigin } from "@/lib/social/meta-store";
import { META_STATE_COOKIE, META_STATE_PATH } from "@/lib/social/meta-state";

/**
 * Mit Facebook verbinden: leitet zur Anmeldung bei Meta weiter. Der Zufallswert
 * `state` liegt bis zum Rücksprung in einem httpOnly-Cookie (10 Minuten).
 */
export async function GET(request: NextRequest) {
  const auth = await newsletterAdmin();
  if ("error" in auth) return auth.error;
  const origin = metaOrigin(request.nextUrl.origin) as string;
  const cfg = metaConfig();
  if (!cfg) return NextResponse.redirect(`${origin}/newsletter?tab=social&meta=nicht-eingerichtet`, 303);
  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(metaAuthorizeUrl(cfg, metaRedirectUri(origin), state), 303);
  res.cookies.set(META_STATE_COOKIE, `${state}.${auth.accountId}`, {
    httpOnly: true,
    secure: origin.startsWith("https://"),
    sameSite: "lax",
    path: META_STATE_PATH,
    maxAge: 600,
  });
  return res;
}
