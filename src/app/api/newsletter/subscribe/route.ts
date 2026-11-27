import { NextRequest, NextResponse } from "next/server";
import { validateApiOrIntegrationToken } from "@/lib/api-token-auth";
import { readRequestBody } from "@/lib/api-body";
import { checkRateLimit, publicRateLimit, requestClientIp } from "@/lib/rate-limit";
import { normalizeEmail } from "@/lib/day-guest";
import { subscribe } from "@/lib/newsletter/service";

/**
 * Newsletter-Anmeldung von der Website (Server zu Server).
 *
 *   POST /api/newsletter/subscribe
 *   Authorization: Bearer <Integrations-Token mit Scope „Newsletter-Anmeldungen“>
 *   { email, name?, source?, ip?, userAgent?, consentText? }
 *
 * `ip` und `userAgent` sind die der Person auf der Website (Nachweis der
 * Einwilligung); die Website prüft vorher selbst auf Bots. Die Antwort ist
 * immer gleich, damit niemand erfährt, welche Adressen eingetragen sind.
 */

export const maxDuration = 20;

/** Je Person (IP von der Website): drei Anmeldungen in zehn Minuten. */
const PERSON_LIMIT = { limit: 3, windowMs: 10 * 60_000 } as const;
const SOURCES = new Set(["website", "app", "kasse"]);

const OK = () =>
  NextResponse.json({ ok: true, message: "Fast geschafft! Bitte bestätige deine Anmeldung über den Link in der E-Mail." });

export async function POST(request: NextRequest) {
  const auth = await validateApiOrIntegrationToken(request, "/api/newsletter/subscribe");
  if ("error" in auth) return auth.error;
  const accountId = auth.account.id;

  const tokenLimited = publicRateLimit(`acc-${accountId}`, "newsletter-subscribe");
  if (tokenLimited) return tokenLimited;

  const body = await readRequestBody(request);
  if (!body) return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  const email = normalizeEmail(body.email);
  if (!email) return NextResponse.json({ error: "Ungültige E-Mail-Adresse" }, { status: 400 });

  const personIp = typeof body.ip === "string" && body.ip.trim() ? body.ip.trim().slice(0, 64) : requestClientIp(request.headers);
  if (!checkRateLimit(`newsletter-person|${accountId}|${personIp}`, PERSON_LIMIT).allowed) {
    return NextResponse.json({ error: "Zu viele Anmeldungen. Bitte versuche es später erneut." }, { status: 429 });
  }

  const source = typeof body.source === "string" && SOURCES.has(body.source) ? body.source : "website";
  try {
    const result = await subscribe(accountId, {
      email,
      name: body.name,
      source,
      ip: personIp === "-" ? null : personIp,
      userAgent: typeof body.userAgent === "string" ? body.userAgent : null,
      consentText: typeof body.consentText === "string" ? body.consentText : null,
    });
    console.log(`[newsletter] Anmeldung (${source}): ${result}`);
    return OK();
  } catch (err) {
    console.error("[newsletter] Anmeldung fehlgeschlagen:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Anmeldung gerade nicht möglich. Bitte später erneut versuchen." }, { status: 500 });
  }
}
