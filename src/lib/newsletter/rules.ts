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

/** Woher eine Adresse kam (NewsletterSubscriber.source). */
export const SOURCE_LABEL: Record<string, string> = {
  website: "Website",
  verwaltung: "Verwaltung",
  app: "Kunden-App",
  kasse: "Kasse",
  import: "Alte Website-Liste",
  wakesys: "Wakesys",
  anny: "anny-Abo",
};

/**
 * „Du bekommst diese Mail, weil …“ unter jeder Aussendung, je nach Herkunft
 * der Adresse. Abo-Kunden aus anny sind Bestandskunden (§ 7 Abs. 3 UWG):
 * Sie bekommen bei jeder Mail den Hinweis, dass sie jederzeit widersprechen
 * können und dafür nur die Übermittlungskosten anfallen.
 */
export function reasonLine(accountName: string, source?: string | null): string {
  switch (source) {
    case "import":
      return `Du bekommst diese Mail, weil du dich auf der Website von ${accountName} für den Newsletter angemeldet hast.`;
    case "wakesys":
      return `Du bekommst diese Mail, weil du bei ${accountName} der Zusendung des Newsletters zugestimmt hast.`;
    case "anny":
      return (
        `Du bekommst diese Mail, weil du ein Abo bei ${accountName} hast. ` +
        "Du kannst der Zusendung jederzeit widersprechen, über den Link unten oder mit einer Antwort auf diese Mail. " +
        "Dafür entstehen dir keine anderen Kosten als die Übermittlungskosten nach den Basistarifen."
      );
    default:
      return `Du bekommst diese Mail, weil du den Newsletter von ${accountName} bestellt und die Anmeldung bestätigt hast.`;
  }
}

// ---------------------------------------------------------------------------
// Gruppen
// ---------------------------------------------------------------------------

/** Feste Gruppen, die emp-access selbst füllt (NewsletterGroup.key). */
export const SYSTEM_GROUP_KEYS = ["website", "anny-abos"] as const;
export type SystemGroupKey = (typeof SYSTEM_GROUP_KEYS)[number];

export const SYSTEM_GROUP_NAME: Record<SystemGroupKey, string> = {
  website: "Website",
  "anny-abos": "Abos aus anny",
};

export const SYSTEM_GROUP_HINT: Record<SystemGroupKey, string> = {
  website: "Anmeldungen über das Website-Formular kommen automatisch hinein.",
  "anny-abos": "Laufende Abos aus anny, stündlich abgeglichen.",
};

/** Wortlaut im Nachweis für Abo-Kunden aus anny. */
export const ANNY_CONSENT_TEXT =
  "Bestandskunde: laufendes Abo aus anny. Werbung für eigene ähnliche Angebote nach § 7 Abs. 3 UWG, " +
  "mit Hinweis auf das Widerspruchsrecht in jeder Mail. Automatisch aufgenommen.";

/** Name einer eigenen Gruppe prüfen. */
export function parseGroupName(value: unknown): { name: string } | { error: string } {
  const name = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!name) return { error: "Name fehlt" };
  if (name.length > 60) return { error: "Name: höchstens 60 Zeichen" };
  return { name };
}

/** Gruppen-IDs aus einer Anfrage: Liste ganzer Zahlen, doppelte entfernt. */
export function parseGroupIds(value: unknown): number[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 50) return null;
  const ids = new Set<number>();
  for (const v of value) {
    const n = typeof v === "string" ? Number(v) : v;
    if (typeof n !== "number" || !Number.isInteger(n) || n <= 0) return null;
    ids.add(n);
  }
  return [...ids].sort((a, b) => a - b);
}

export interface AnnyAboContact {
  /** Schon normalisiert (klein, ohne Leerzeichen). */
  email: string;
  name: string | null;
}

export interface AnnyGroupPlan {
  /** Adressen ohne Abonnent: neu als angemeldet anlegen. */
  create: AnnyAboContact[];
  /** Vorhandene Abonnenten, die in die Gruppe gehören. */
  memberIds: number[];
  /** Mitglieder ohne laufendes Abo: aus der Gruppe nehmen (bleiben Abonnent). */
  removeIds: number[];
}

/**
 * Abgleich der Gruppe „Abos aus anny“. Wer sich abgemeldet hat, bleibt
 * abgemeldet: Vorhandene Abonnenten werden nur der Gruppe zugeordnet, ihr
 * Status bleibt, wie er ist.
 */
export function annyGroupPlan(
  abos: AnnyAboContact[],
  subscribers: Array<{ id: number; email: string }>,
  currentMemberIds: number[],
): AnnyGroupPlan {
  const byEmail = new Map<string, AnnyAboContact>();
  for (const a of abos) {
    const prev = byEmail.get(a.email);
    if (!prev || (!prev.name && a.name)) byEmail.set(a.email, a);
  }
  const known = new Map(subscribers.map((s) => [s.email, s.id]));
  const create: AnnyAboContact[] = [];
  const memberIds: number[] = [];
  for (const [email, a] of byEmail) {
    const id = known.get(email);
    if (id) memberIds.push(id);
    else create.push(a);
  }
  const keep = new Set(memberIds);
  return { create, memberIds, removeIds: currentMemberIds.filter((id) => !keep.has(id)) };
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
