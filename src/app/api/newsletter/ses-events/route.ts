import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { applySesEvent } from "@/lib/newsletter/service";
import {
  isSnsCertUrl, isSnsSubscribeUrl, parseSesEvent, parseSnsMessage, verifySnsSignature,
} from "@/lib/newsletter/sns";
import { createTtlCache } from "@/lib/ttl-cache";

/**
 * Rückmeldungen von Amazon SES über SNS: Zustellung, Rückläufer, Beschwerden.
 *
 * In AWS: SES-Konfigurationssatz → Ereignisziel SNS-Thema → Abonnement
 * HTTPS auf https://www.emp-access.de/api/newsletter/ses-events. Das Thema
 * (ARN) steht in den Newsletter-Einstellungen; andere Themen weist die Route
 * ab, auch wenn SNS sie korrekt signiert hat.
 */

export const maxDuration = 20;

const certCache = createTtlCache<string>(6 * 60 * 60_000, { maxEntries: 10 });

async function loadCert(url: string): Promise<string> {
  return certCache.get(url, async () => {
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000), cache: "no-store" });
    if (!res.ok) throw new Error(`Zertifikat nicht ladbar (${res.status})`);
    const pem = await res.text();
    if (!pem.includes("BEGIN CERTIFICATE")) throw new Error("Zertifikat ungültig");
    return pem;
  });
}

export async function POST(request: NextRequest) {
  const raw = await request.text();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Kein JSON" }, { status: 400 });
  }
  const msg = parseSnsMessage(body);
  if (!msg || !isSnsCertUrl(msg.SigningCertURL)) return NextResponse.json({ error: "Keine SNS-Meldung" }, { status: 400 });

  const config = await prisma.newsletterConfig.findFirst({
    where: { snsTopicArn: msg.TopicArn },
    select: { accountId: true },
  });
  if (!config) {
    console.warn("[newsletter] SNS-Meldung von unbekanntem Thema:", msg.TopicArn);
    return NextResponse.json({ error: "Thema nicht eingetragen" }, { status: 403 });
  }

  let valid = false;
  try {
    valid = verifySnsSignature(msg, await loadCert(msg.SigningCertURL));
  } catch (err) {
    console.error("[newsletter] SNS-Zertifikat:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Zertifikat nicht prüfbar" }, { status: 502 });
  }
  if (!valid) return NextResponse.json({ error: "Signatur ungültig" }, { status: 403 });

  if (msg.Type === "SubscriptionConfirmation") {
    if (!msg.SubscribeURL || !isSnsSubscribeUrl(msg.SubscribeURL)) {
      return NextResponse.json({ error: "Bestätigungslink ungültig" }, { status: 400 });
    }
    const res = await fetch(msg.SubscribeURL, { signal: AbortSignal.timeout(5_000), cache: "no-store" });
    console.log(`[newsletter] SNS-Abonnement bestätigt (${res.status}) für Mandant ${config.accountId}`);
    return NextResponse.json({ ok: res.ok });
  }
  if (msg.Type !== "Notification") return NextResponse.json({ ok: true });

  const event = parseSesEvent(msg.Message);
  if (!event) return NextResponse.json({ ok: true, ignored: "kein SES-Ereignis" });
  const result = await applySesEvent(config.accountId, event);
  if (event.kind !== "delivery") console.log(`[newsletter] SES ${event.kind}: ${result}`);
  return NextResponse.json({ ok: true, result });
}
