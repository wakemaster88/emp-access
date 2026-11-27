import type { NextRequest } from "next/server";
import { resolveLink, unsubscribeSubscriber } from "@/lib/newsletter/service";
import { INVALID_LINK_PAGE, publicPageResponse } from "@/lib/newsletter/public-page";
import { checkRateLimit, requestClientIp } from "@/lib/rate-limit";

/**
 * Abmelden. Der Link in jeder Mail öffnet diese Seite, die Taste meldet ab.
 * Mailprogramme melden über die Kopfzeile List-Unsubscribe mit
 * POST „List-Unsubscribe=One-Click“ direkt ab (RFC 8058), ohne Seite.
 *
 * Die Website leitet tuttenbrocksee.com/newsletter/abmelden hierher weiter.
 */

export const dynamic = "force-dynamic";

const LIMIT = { limit: 60, windowMs: 60_000 } as const;

function limited(request: NextRequest): Response | null {
  const r = checkRateLimit(`nl-unsub|${requestClientIp(request.headers)}`, LIMIT);
  return r.allowed ? null : new Response("Zu viele Anfragen. Bitte kurz warten.", { status: 429 });
}

export async function GET(request: NextRequest) {
  const tooMany = limited(request);
  if (tooMany) return tooMany;
  const token = request.nextUrl.searchParams.get("t");
  const target = await resolveLink(token, "u");
  if (!target || !token) return publicPageResponse(INVALID_LINK_PAGE);
  const brand = target.ctx.brand;
  if (target.subscriber.status !== "ACTIVE" && target.subscriber.status !== "PENDING") {
    return publicPageResponse({ brand, title: "Schon abgemeldet", lines: [`${target.subscriber.email} bekommt keinen Newsletter mehr von uns.`] });
  }
  return publicPageResponse({
    brand,
    title: "Newsletter abbestellen",
    lines: [`Möchtest du den Newsletter von ${target.ctx.accountName} an ${target.subscriber.email} abbestellen?`],
    form: { token, label: "Ja, abmelden" },
  });
}

export async function POST(request: NextRequest) {
  const tooMany = limited(request);
  if (tooMany) return tooMany;
  const form = await request.formData().catch(() => null);
  const oneClick = form?.get("List-Unsubscribe") === "One-Click";
  const token = (form?.get("t") as string | null) ?? request.nextUrl.searchParams.get("t");
  const target = await resolveLink(token, "u");
  if (!target) {
    return oneClick ? new Response("Link ungültig", { status: 404 }) : publicPageResponse(INVALID_LINK_PAGE);
  }
  await unsubscribeSubscriber(target, oneClick ? "one-click" : "link");
  if (oneClick) return new Response("Abgemeldet", { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
  return publicPageResponse({
    brand: target.ctx.brand,
    title: "Du bist abgemeldet",
    lines: [`${target.subscriber.email} bekommt keinen Newsletter mehr von uns.`, "Schade, dass du gehst. Du kannst dich jederzeit auf der Website wieder anmelden."],
  });
}
