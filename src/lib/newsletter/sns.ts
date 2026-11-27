import { createVerify } from "node:crypto";

/**
 * Meldungen von Amazon SNS (SES meldet Zustellung, Rückläufer und
 * Beschwerden über ein SNS-Thema an /api/newsletter/ses-events).
 *
 * Die Signatur beweist nur, dass die Meldung von SNS kommt – nicht, dass es
 * unser Thema ist. Jeder kann ein eigenes Thema auf unsere Adresse richten.
 * Die Route nimmt deshalb nur das in der Verwaltung eingetragene Thema (ARN).
 */

export interface SnsMessage {
  Type: string;
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: string;
  Signature: string;
  SigningCertURL: string;
  Subject?: string;
  Token?: string;
  SubscribeURL?: string;
}

export function parseSnsMessage(body: unknown): SnsMessage | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const required = ["Type", "MessageId", "TopicArn", "Message", "Timestamp", "SignatureVersion", "Signature", "SigningCertURL"];
  for (const k of required) if (typeof b[k] !== "string") return null;
  return b as unknown as SnsMessage;
}

/** Zertifikat nur von SNS selbst (https://sns.<region>.amazonaws.com/….pem). */
export function isSnsCertUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/.test(u.hostname) &&
      u.pathname.endsWith(".pem") &&
      !u.port
    );
  } catch {
    return false;
  }
}

/** Bestätigungslink einer neuen Verbindung, ebenfalls nur zu SNS selbst. */
export function isSnsSubscribeUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/.test(u.hostname) && !u.port;
  } catch {
    return false;
  }
}

/** Zu signierender Text nach https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html */
export function snsStringToSign(m: SnsMessage): string | null {
  const keys =
    m.Type === "Notification"
      ? ["Message", "MessageId", ...(m.Subject !== undefined ? ["Subject"] : []), "Timestamp", "TopicArn", "Type"]
      : m.Type === "SubscriptionConfirmation" || m.Type === "UnsubscribeConfirmation"
        ? ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"]
        : null;
  if (!keys) return null;
  let out = "";
  for (const k of keys) {
    const v = (m as unknown as Record<string, unknown>)[k];
    if (typeof v !== "string") return null;
    out += `${k}\n${v}\n`;
  }
  return out;
}

/** Signatur prüfen. `certPem` ist das Zertifikat von SigningCertURL. */
export function verifySnsSignature(m: SnsMessage, certPem: string): boolean {
  const text = snsStringToSign(m);
  if (!text) return false;
  const algo = m.SignatureVersion === "1" ? "RSA-SHA1" : m.SignatureVersion === "2" ? "RSA-SHA256" : null;
  if (!algo) return false;
  try {
    return createVerify(algo).update(text, "utf8").verify(certPem, m.Signature, "base64");
  } catch {
    return false;
  }
}

export type SesEventKind = "delivery" | "bounce" | "complaint" | "reject" | "other";

export interface SesEvent {
  kind: SesEventKind;
  /** Nur bei Rückläufern: dauerhaft (Adresse gibt es nicht) oder vorübergehend. */
  permanent: boolean;
  messageId: string | null;
  recipients: string[];
  tags: Record<string, string>;
  at: Date;
  detail: string | null;
}

/** SES-Ereignis aus Message (Ereignis-Veröffentlichung oder Identitäts-Meldung). */
export function parseSesEvent(message: string): SesEvent | null {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(message) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!j || typeof j !== "object") return null;
  const type = String(j.eventType ?? j.notificationType ?? "");
  const mail = (j.mail ?? {}) as Record<string, unknown>;
  const rawTags = (mail.tags ?? {}) as Record<string, unknown>;
  const tags: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawTags)) {
    if (Array.isArray(v) && typeof v[0] === "string") tags[k] = v[0];
  }
  const messageId = typeof mail.messageId === "string" ? mail.messageId : null;
  const lower = (list: unknown, key?: string): string[] =>
    Array.isArray(list)
      ? list
          .map((r) => (key ? (r as Record<string, unknown>)?.[key] : r))
          .filter((x): x is string => typeof x === "string")
          .map((x) => x.trim().toLowerCase())
      : [];
  const when = (v: unknown): Date => {
    const d = typeof v === "string" ? new Date(v) : null;
    return d && !Number.isNaN(d.getTime()) ? d : new Date();
  };

  switch (type) {
    case "Bounce": {
      const b = (j.bounce ?? {}) as Record<string, unknown>;
      const first = Array.isArray(b.bouncedRecipients) ? (b.bouncedRecipients[0] as Record<string, unknown>) : null;
      return {
        kind: "bounce",
        permanent: b.bounceType === "Permanent",
        messageId,
        recipients: lower(b.bouncedRecipients, "emailAddress"),
        tags,
        at: when(b.timestamp),
        detail:
          [b.bounceType, b.bounceSubType, typeof first?.diagnosticCode === "string" ? first.diagnosticCode : null]
            .filter(Boolean)
            .join(" · ")
            .slice(0, 300) || null,
      };
    }
    case "Complaint": {
      const c = (j.complaint ?? {}) as Record<string, unknown>;
      return {
        kind: "complaint",
        permanent: true,
        messageId,
        recipients: lower(c.complainedRecipients, "emailAddress"),
        tags,
        at: when(c.timestamp),
        detail: typeof c.complaintFeedbackType === "string" ? c.complaintFeedbackType : null,
      };
    }
    case "Delivery": {
      const d = (j.delivery ?? {}) as Record<string, unknown>;
      return { kind: "delivery", permanent: false, messageId, recipients: lower(d.recipients), tags, at: when(d.timestamp), detail: null };
    }
    case "Reject": {
      const r = (j.reject ?? {}) as Record<string, unknown>;
      return {
        kind: "reject",
        permanent: true,
        messageId,
        recipients: lower(mail.destination),
        tags,
        at: when(mail.timestamp),
        detail: typeof r.reason === "string" ? r.reason.slice(0, 300) : null,
      };
    }
    default:
      return { kind: "other", permanent: false, messageId, recipients: lower(mail.destination), tags, at: new Date(), detail: type || null };
  }
}
