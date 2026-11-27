import MailComposer from "nodemailer/lib/mail-composer";

/**
 * Fertige MIME-Nachricht für SES (Content.Raw). Nur so lassen sich die
 * Kopfzeilen für die Ein-Klick-Abmeldung nach RFC 8058 setzen, die Gmail und
 * Yahoo von Massenversendern verlangen.
 */
export interface RawMailInput {
  fromEmail: string;
  fromName?: string | null;
  to: string;
  replyTo?: string | null;
  subject: string;
  html: string;
  text: string;
  /** https-Adresse, die auf POST „List-Unsubscribe=One-Click“ sofort abmeldet. */
  unsubscribeUrl?: string | null;
}

/** Kopfzeilen für die Abmeldung; leer ohne Link (z. B. Bestätigungsmail). */
export function unsubscribeHeaders(url: string | null | undefined): Record<string, string> {
  if (!url) return {};
  return {
    "List-Unsubscribe": `<${url}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

export function buildRawMail(input: RawMailInput): Promise<Buffer> {
  const composer = new MailComposer({
    from: input.fromName ? { name: input.fromName, address: input.fromEmail } : input.fromEmail,
    to: input.to,
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    subject: input.subject,
    html: input.html,
    text: input.text,
    headers: unsubscribeHeaders(input.unsubscribeUrl),
  });
  return new Promise((resolve, reject) => {
    composer.compile().build((err, message) => (err ? reject(err) : resolve(message)));
  });
}
