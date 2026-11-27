import type { NextRequest } from "next/server";
import { confirmSubscriber, resolveLink } from "@/lib/newsletter/service";
import { INVALID_LINK_PAGE, publicPageResponse } from "@/lib/newsletter/public-page";
import { checkRateLimit, requestClientIp } from "@/lib/rate-limit";

/**
 * Double-Opt-in: Der Link aus der Bestätigungsmail öffnet diese Seite. Erst
 * der Klick auf die Taste (POST) bestätigt. So bestätigen Link-Scanner von
 * Mailprogrammen nicht von selbst.
 *
 * Die Website leitet tuttenbrocksee.com/newsletter/bestaetigen hierher
 * weiter (NewsletterConfig.linkBaseUrl).
 */

export const dynamic = "force-dynamic";

const LIMIT = { limit: 30, windowMs: 60_000 } as const;

function limited(request: NextRequest): Response | null {
  const r = checkRateLimit(`nl-confirm|${requestClientIp(request.headers)}`, LIMIT);
  return r.allowed ? null : new Response("Zu viele Anfragen. Bitte kurz warten.", { status: 429 });
}

export async function GET(request: NextRequest) {
  const tooMany = limited(request);
  if (tooMany) return tooMany;
  const token = request.nextUrl.searchParams.get("t");
  const target = await resolveLink(token, "c");
  if (!target || !token) return publicPageResponse(INVALID_LINK_PAGE);
  const brand = target.ctx.brand;
  if (target.subscriber.status === "ACTIVE") {
    return publicPageResponse({ brand, title: "Schon bestätigt", lines: [`${target.subscriber.email} ist bereits für den Newsletter angemeldet.`] });
  }
  if (target.subscriber.status !== "PENDING") {
    return publicPageResponse({ ...INVALID_LINK_PAGE, brand });
  }
  return publicPageResponse({
    brand,
    title: "Anmeldung bestätigen",
    lines: [`Möchtest du den Newsletter von ${target.ctx.accountName} an ${target.subscriber.email} bekommen?`],
    form: { token, label: "Ja, Anmeldung bestätigen" },
  });
}

export async function POST(request: NextRequest) {
  const tooMany = limited(request);
  if (tooMany) return tooMany;
  const form = await request.formData().catch(() => null);
  const token = (form?.get("t") as string | null) ?? request.nextUrl.searchParams.get("t");
  const target = await resolveLink(token, "c");
  if (!target) return publicPageResponse(INVALID_LINK_PAGE);
  const ip = requestClientIp(request.headers);
  const result = await confirmSubscriber(target, ip === "-" ? null : ip);
  const brand = target.ctx.brand;
  if (result === "gone") return publicPageResponse({ ...INVALID_LINK_PAGE, brand });
  return publicPageResponse({
    brand,
    title: "Danke!",
    lines: [
      "Deine Anmeldung ist bestätigt. Ab jetzt bekommst du unsere Angebote und Neuigkeiten als Erste.",
      "Abmelden kannst du dich jederzeit über den Link unten in jeder Mail.",
    ],
  });
}
