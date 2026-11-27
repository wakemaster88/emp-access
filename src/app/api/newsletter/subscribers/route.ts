import { NextRequest, NextResponse } from "next/server";
import { readRequestBody } from "@/lib/api-body";
import { normalizeEmail } from "@/lib/day-guest";
import { newsletterAdmin } from "@/lib/newsletter/admin-auth";
import { loadSendContext, subscribe } from "@/lib/newsletter/service";

/**
 * Adresse in der Verwaltung eintragen. Auch hier gilt Double-Opt-in: Die
 * Person bekommt die Bestätigungsmail und ist erst nach dem Klick angemeldet.
 */
export async function POST(request: NextRequest) {
  const auth = await newsletterAdmin();
  if ("error" in auth) return auth.error;
  const body = await readRequestBody(request);
  const email = normalizeEmail(body?.email);
  if (!email) return NextResponse.json({ error: "Bitte eine gültige E-Mail-Adresse eingeben" }, { status: 400 });
  const by = auth.userName || auth.userEmail || "Verwaltung";
  const result = await subscribe(auth.accountId, {
    email,
    name: body?.name,
    source: "verwaltung",
    consentText: `In der Verwaltung eingetragen von ${by}. Angemeldet erst nach Bestätigung über den Link in der Mail.`,
  });
  const ready = result === "pending" && (await loadSendContext(auth.accountId)).gaps.length === 0;
  const message =
    result === "active" ? "Diese Adresse ist schon angemeldet."
    : result === "throttled" ? "An diese Adresse ging gerade erst eine Bestätigungsmail."
    : ready ? "Die Bestätigungsmail ist unterwegs. Angemeldet ist die Adresse erst nach dem Klick auf den Link."
    : "Eingetragen. Die Bestätigungsmail geht raus, sobald der Versand bereit ist (bis 7 Tage nach dem Eintragen).";
  return NextResponse.json({ ok: true, result, message });
}
