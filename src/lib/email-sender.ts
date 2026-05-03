/**
 * Mail-Versand via Resend HTTP API.
 *
 * Wir benutzen `fetch`, um ohne Zusatz-Dependency auszukommen. Sollte später
 * SMTP nötig werden, kann hier ein zweiter Pfad ergänzt werden.
 */

export interface EmailProvider {
  provider: string; // "RESEND" | "SMTP"
  apiKey: string | null;
  fromEmail: string;
  fromName: string | null;
  replyTo: string | null;
}

export interface SendEmailArgs {
  config: EmailProvider;
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface SendEmailResult {
  ok: boolean;
  id?: string;
  error?: string;
}

function buildFrom(config: EmailProvider): string {
  const name = config.fromName?.trim();
  return name ? `${name} <${config.fromEmail}>` : config.fromEmail;
}

export async function sendEmail({
  config,
  to,
  subject,
  html,
  text,
}: SendEmailArgs): Promise<SendEmailResult> {
  if (!config.apiKey) {
    return { ok: false, error: "Kein API-Key konfiguriert." };
  }
  if (!config.fromEmail) {
    return { ok: false, error: "Kein Absender (fromEmail) konfiguriert." };
  }
  if (!to || !to.includes("@")) {
    return { ok: false, error: `Ungültige Empfängeradresse: ${to}` };
  }

  if (config.provider !== "RESEND") {
    return { ok: false, error: `Provider ${config.provider} ist nicht implementiert.` };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        from: buildFrom(config),
        to: [to],
        subject,
        html,
        text,
        ...(config.replyTo ? { reply_to: config.replyTo } : {}),
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Resend ${res.status}: ${body.slice(0, 300)}` };
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { ok: true, id: data.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
