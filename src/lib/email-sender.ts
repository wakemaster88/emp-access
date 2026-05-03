/**
 * Mail-Versand via Gmail SMTP (nodemailer).
 *
 * Authentifizierung erfolgt mit einem Google App-Passwort. Voraussetzung
 * im Gmail-Account:
 *   1. 2-Faktor-Authentifizierung aktivieren.
 *   2. App-Passwort generieren (https://myaccount.google.com/apppasswords).
 *   3. Hier als `apiKey` speichern, `fromEmail` muss die zugehörige
 *      Gmail-Adresse sein.
 *
 * Hinweis: Gmail erlaubt nur den Versand mit der eigenen Adresse als
 * `From`-Header (oder einem dort verifizierten Alias). Daher prüfen wir
 * nichts zur Laufzeit – falls Gmail die Mail ablehnt, taucht der Fehler
 * im `EmailSend`-Log auf.
 */

import nodemailer, { type Transporter } from "nodemailer";

export interface EmailProvider {
  provider: string; // "GMAIL" (default) | "RESEND" (legacy)
  apiKey: string | null; // Gmail App-Passwort
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
  return name ? `"${name.replace(/"/g, "")}" <${config.fromEmail}>` : config.fromEmail;
}

/**
 * Wir cachen Transporter pro (user+pass), um SMTP-Verbindungen wiederzuverwenden,
 * solange der Lambda/Worker lebt. nodemailer hält den TCP-Pool selbst offen.
 */
const transporterCache = new Map<string, Transporter>();

function getGmailTransporter(user: string, pass: string): Transporter {
  const key = `${user}::${pass.slice(0, 4)}::${pass.length}`;
  const cached = transporterCache.get(key);
  if (cached) return cached;
  const t = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass },
    pool: true,
    maxConnections: 1,
    maxMessages: 30,
  });
  transporterCache.set(key, t);
  return t;
}

export async function sendEmail({
  config,
  to,
  subject,
  html,
  text,
}: SendEmailArgs): Promise<SendEmailResult> {
  if (!config.apiKey) {
    return { ok: false, error: "Kein Gmail App-Passwort konfiguriert." };
  }
  if (!config.fromEmail) {
    return { ok: false, error: "Kein Absender (fromEmail) konfiguriert." };
  }
  if (!to || !to.includes("@")) {
    return { ok: false, error: `Ungültige Empfängeradresse: ${to}` };
  }

  // Nur Gmail-SMTP wird unterstützt. Provider-String dient als Erweiterungspunkt.
  if (config.provider !== "GMAIL") {
    return {
      ok: false,
      error: `Provider ${config.provider} ist nicht unterstützt. Bitte auf GMAIL umstellen.`,
    };
  }

  try {
    const transporter = getGmailTransporter(config.fromEmail, config.apiKey);
    const info = await transporter.sendMail({
      from: buildFrom(config),
      to,
      subject,
      html,
      text,
      ...(config.replyTo ? { replyTo: config.replyTo } : {}),
    });
    return { ok: true, id: info.messageId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}
