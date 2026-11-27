import { NextRequest, NextResponse } from "next/server";
import { newsletterAdmin } from "@/lib/newsletter/admin-auth";
import { exchangeCodeForUserToken, grantedScopes, graphClient, listPages, metaConfig, metaErrorText, metaRedirectUri } from "@/lib/social/meta";
import { metaOrigin, saveMetaLogin } from "@/lib/social/meta-store";
import { prisma } from "@/lib/prisma";
import { META_STATE_COOKIE, META_STATE_PATH, stateMatches } from "@/lib/social/meta-state";

export const maxDuration = 30;

/** Rücksprung von Meta: Code gegen Token tauschen, Seite und Instagram-Profil merken. */
export async function GET(request: NextRequest) {
  const auth = await newsletterAdmin();
  if ("error" in auth) return auth.error;
  const origin = metaOrigin(request.nextUrl.origin) as string;
  const back = (result: string) => {
    const res = NextResponse.redirect(`${origin}/newsletter?tab=social&meta=${result}`, 303);
    res.cookies.set(META_STATE_COOKIE, "", { path: META_STATE_PATH, maxAge: 0 });
    return res;
  };
  const cfg = metaConfig();
  if (!cfg) return back("nicht-eingerichtet");
  const q = request.nextUrl.searchParams;
  if (!stateMatches(request.cookies.get(META_STATE_COOKIE)?.value, q.get("state"), auth.accountId)) return back("abgelaufen");
  if (q.get("error")) return back("abgebrochen");
  const code = q.get("code");
  if (!code) return back("abgebrochen");
  try {
    const client = graphClient(cfg);
    const userToken = await exchangeCodeForUserToken(client, cfg, code, metaRedirectUri(origin));
    const [scopes, pages] = await Promise.all([grantedScopes(client, userToken), listPages(client, userToken)]);
    const result = await saveMetaLogin(auth.accountId, { userToken, scopes, pages, by: auth.userName || auth.userEmail });
    return back(result === "connected" ? "verbunden" : result === "choose" ? "seite-waehlen" : result === "no-page" ? "keine-seite" : "rechte-fehlen");
  } catch (err) {
    const message = metaErrorText(err);
    console.error("[social/meta] Anmeldung fehlgeschlagen:", message);
    await prisma.socialMetaConnection.upsert({
      where: { accountId: auth.accountId },
      create: { accountId: auth.accountId, lastError: message, lastErrorAt: new Date() },
      update: { lastError: message, lastErrorAt: new Date() },
    });
    return back("fehler");
  }
}
