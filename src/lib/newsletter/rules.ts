/**
 * Regeln des Newsletters ohne Datenbank: Zustände, Bereitschaft, Links und
 * was bei einer Anmeldung passiert. Die Datenbank-Seite steht in ./service.
 */

export const SUBSCRIBER_STATUSES = ["PENDING", "ACTIVE", "UNSUBSCRIBED", "BOUNCED", "COMPLAINED"] as const;
export type SubscriberStatus = (typeof SUBSCRIBER_STATUSES)[number];

export const SUBSCRIBER_STATUS_LABEL: Record<SubscriberStatus, string> = {
  PENDING: "Bestätigung offen",
  ACTIVE: "Angemeldet",
  UNSUBSCRIBED: "Abgemeldet",
  BOUNCED: "Unzustellbar",
  COMPLAINED: "Als Spam gemeldet",
};

export const CAMPAIGN_STATUSES = ["DRAFT", "QUEUED", "SENDING", "SENT", "CANCELLED"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
  DRAFT: "Entwurf",
  QUEUED: "Wartet auf Versand",
  SENDING: "Wird versendet",
  SENT: "Versendet",
  CANCELLED: "Abgebrochen",
};

export const SEND_STATUSES = ["QUEUED", "SENDING", "SENT", "DELIVERED", "FAILED", "SKIPPED", "BOUNCED", "COMPLAINED"] as const;
export type SendStatus = (typeof SEND_STATUSES)[number];

/** Standardtext der Einwilligung (wird mit jeder Anmeldung gespeichert). */
export function defaultConsentText(accountName: string): string {
  return (
    `Ich möchte den Newsletter von ${accountName} mit Angeboten, Neuigkeiten und Veranstaltungen per E-Mail erhalten. ` +
    "Die Einwilligung kann ich jederzeit über den Abmeldelink in jeder Mail widerrufen."
  );
}

/** Bestätigungsmail höchstens einmal je Stunde an dieselbe Adresse … */
export const CONFIRM_RESEND_AFTER_MS = 60 * 60 * 1000;
/** … und höchstens so oft, bis eine Woche Ruhe war. */
export const CONFIRM_MAX_MAILS = 5;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type SubscribeAction =
  /** Neu anlegen (PENDING) und Bestätigungsmail senden. */
  | "create"
  /** Wieder auf PENDING setzen und Bestätigungsmail senden. */
  | "reopen"
  /** Noch PENDING: Bestätigungsmail erneut senden. */
  | "resend"
  /** Schon angemeldet: nichts tun. */
  | "active"
  /** Gerade erst gesendet oder zu oft: keine weitere Mail. */
  | "throttled";

export function subscribeAction(
  existing: { status: string; confirmMailSentAt: Date | null; confirmMailCount: number } | null,
  now: Date = new Date(),
): SubscribeAction {
  if (!existing) return "create";
  if (existing.status === "ACTIVE") return "active";
  const last = existing.confirmMailSentAt?.getTime() ?? 0;
  const since = now.getTime() - last;
  if (last && since < CONFIRM_RESEND_AFTER_MS) return "throttled";
  if (existing.confirmMailCount >= CONFIRM_MAX_MAILS && last && since < WEEK_MS) return "throttled";
  return existing.status === "PENDING" ? "resend" : "reopen";
}

/** Zähler für Bestätigungsmails: nach einer Woche Ruhe beginnt er neu. */
export function nextConfirmMailCount(previous: { confirmMailSentAt: Date | null; confirmMailCount: number } | null, now: Date = new Date()): number {
  if (!previous?.confirmMailSentAt) return 1;
  return now.getTime() - previous.confirmMailSentAt.getTime() >= WEEK_MS ? 1 : previous.confirmMailCount + 1;
}

export interface ReadinessInput {
  enabled: boolean;
  fromEmail: string | null;
  hasSesCredentials: boolean;
}

/** Was fehlt, bevor Mails rausgehen dürfen (leer = bereit). */
export function readinessGaps(c: ReadinessInput): string[] {
  const gaps: string[] = [];
  if (!c.hasSesCredentials) gaps.push("SES-Zugangsdaten in Vercel fehlen (SES_ACCESS_KEY_ID, SES_SECRET_ACCESS_KEY)");
  if (!c.fromEmail) gaps.push("Absender-Adresse fehlt");
  if (!c.enabled) gaps.push("Versand ist ausgeschaltet");
  return gaps;
}

/** Basis der Links: eingetragene Adresse oder diese App unter /nl. */
export function linkBase(linkBaseUrl: string | null | undefined, appOrigin: string): string {
  const raw = (linkBaseUrl ?? "").trim().replace(/\/+$/, "");
  if (raw && /^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(raw)) return raw;
  return `${appOrigin.replace(/\/+$/, "")}/nl`;
}

export function confirmLink(base: string, token: string): string {
  return `${base}/bestaetigen?t=${encodeURIComponent(token)}`;
}

export function unsubscribeLink(base: string, token: string): string {
  return `${base}/abmelden?t=${encodeURIComponent(token)}`;
}

/** „Du bekommst diese Mail, weil …“ unter jeder Aussendung. */
export function reasonLine(accountName: string): string {
  return `Du bekommst diese Mail, weil du den Newsletter von ${accountName} bestellt und die Anmeldung bestätigt hast.`;
}

/** Einfache Prüfung für Absender und Antwortadresse. */
export function isPlainEmail(value: string): boolean {
  return value.length <= 180 && /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/.test(value);
}

/** ARN eines SNS-Themas, z. B. arn:aws:sns:eu-central-1:123456789012:newsletter */
export function isSnsTopicArn(value: string): boolean {
  return /^arn:aws(-[a-z]+)?:sns:[a-z0-9-]+:\d{12}:[A-Za-z0-9_-]{1,256}$/.test(value);
}

/** Name eines SES-Konfigurationssatzes. */
export function isConfigurationSetName(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(value);
}
