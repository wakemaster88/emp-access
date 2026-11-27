import type { NextRequest } from "next/server";
import {
  loadSendContext, publicNewsletterAccount, resolveLink, sendUnsubscribeLink, unsubscribeSubscriber,
} from "@/lib/newsletter/service";
import { publicPageResponse, type PublicPage } from "@/lib/newsletter/public-page";
import { checkRateLimit, requestClientIp } from "@/lib/rate-limit";

/**
 * Abmelden. Der Link in jeder Mail öffnet diese Seite, die Taste meldet ab.
 * Mailprogramme melden über die Kopfzeile List-Unsubscribe mit
 * POST „List-Unsubscribe=One-Click“ direkt ab (RFC 8058), ohne Seite.
 *
 * Ohne Link (z. B. von der Website verlinkt) zeigt die Seite ein Feld für die
 * E-Mail-Adresse. Ist sie angemeldet, kommt eine Mail mit dem Abmeldelink.
 * Die Antwort ist immer dieselbe, damit niemand prüfen kann, wer angemeldet ist.
 *
 * Die Website leitet tuttenbrocksee.com/newsletter/abmelden hierher weiter.
 */

export const dynamic = "force-dynamic";

const LIMIT = { limit: 60, windowMs: 60_000 } as const;
/** Abmeldelink per Mail: je IP 5 in 10 Minuten, je Adresse 2 je Stunde. */
const MAIL_IP_LIMIT = { limit: 5, windowMs: 10 * 60_000 } as const;
const MAIL_ADDRESS_LIMIT = { limit: 2, windowMs: 60 * 60_000 } as const;

function limited(request: NextRequest): Response | null {
  const r = checkRateLimit(`nl-unsub|${requestClientIp(request.headers)}`, LIMIT);
  return r.allowed ? null : new Response("Zu viele Anfragen. Bitte kurz warten.", { status: 429 });
}

async function emailFormPage(accountId: number | null, linkInvalid: boolean): Promise<PublicPage> {
  const brand = accountId ? (await loadSendContext(accountId)).brand : null;
  return {
    brand,
    title: "Newsletter abbestellen",
    lines: [
      ...(linkInvalid ? ["Dieser Abmeldelink ist ungültig oder abgelaufen."] : []),
      "Gib die Adresse ein, die den Newsletter bekommt. Wir schicken dir eine Mail mit dem Link zum Abmelden.",
    ],
    emailForm: { label: "Abmeldelink schicken", accountId },
    status: linkInvalid ? 404 : 200,
  };
}

export async function GET(request: NextRequest) {
  const tooMany = limited(request);
  if (tooMany) return tooMany;
  const token = request.nextUrl.searchParams.get("t");
  const target = token ? await resolveLink(token, "u") : null;
  if (!target || !token) {
    const accountId = await publicNewsletterAccount(request.nextUrl.searchParams.get("a"));
    return publicPageResponse(await emailFormPage(accountId, !!token));
  }
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
  const email = form?.get("email");
  if (!oneClick && typeof email === "string" && !form?.get("t")) return requestLinkByMail(request, form?.get("a"), email);

  const token = (form?.get("t") as string | null) ?? request.nextUrl.searchParams.get("t");
  const target = await resolveLink(token, "u");
  if (!target) {
    if (oneClick) return new Response("Link ungültig", { status: 404 });
    return publicPageResponse(await emailFormPage(await publicNewsletterAccount(request.nextUrl.searchParams.get("a")), true));
  }
  await unsubscribeSubscriber(target, oneClick ? "one-click" : "link");
  if (oneClick) return new Response("Abgemeldet", { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
  return publicPageResponse({
    brand: target.ctx.brand,
    title: "Du bist abgemeldet",
    lines: [`${target.subscriber.email} bekommt keinen Newsletter mehr von uns.`, "Schade, dass du gehst. Du kannst dich jederzeit auf der Website wieder anmelden."],
  });
}

async function requestLinkByMail(request: NextRequest, rawAccount: unknown, email: string): Promise<Response> {
  const accountId = await publicNewsletterAccount(rawAccount ?? request.nextUrl.searchParams.get("a"));
  if (!accountId) {
    return publicPageResponse({
      title: "Newsletter abbestellen",
      lines: ["Das hat nicht geklappt. Bitte nutze den Link „Newsletter abbestellen“ unten in einer unserer Mails."],
      status: 400,
    });
  }
  const ip = requestClientIp(request.headers);
  const address = email.trim().toLowerCase().slice(0, 180);
  const allowed =
    checkRateLimit(`nl-unsub-mail|${ip}`, MAIL_IP_LIMIT).allowed &&
    checkRateLimit(`nl-unsub-mail|${accountId}|${address}`, MAIL_ADDRESS_LIMIT).allowed;
  if (allowed) {
    const result = await sendUnsubscribeLink(accountId, address).catch((err) => {
      console.error("[newsletter] Abmeldelink per Mail fehlgeschlagen:", err instanceof Error ? err.message : err);
      return "error";
    });
    console.log(`[newsletter] Abmeldelink angefordert: ${result}`);
  }
  const brand = (await loadSendContext(accountId)).brand;
  return publicPageResponse({
    brand,
    title: "Schau in dein Postfach",
    lines: [
      "Wenn diese Adresse den Newsletter bekommt, ist gleich eine Mail mit dem Link zum Abmelden unterwegs.",
      "Keine Mail da? Schau auch im Spam-Ordner nach oder antworte einfach auf einen unserer Newsletter.",
    ],
  });
}
