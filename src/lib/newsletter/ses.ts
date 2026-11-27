import { signAwsRequest, type AwsCredentials } from "./sigv4";

/**
 * Amazon SES v2 über HTTPS (eigene SigV4-Signatur, kein SDK).
 *
 * Zugangsdaten nur aus der Umgebung (Vercel → Environment Variables):
 *   SES_ACCESS_KEY_ID, SES_SECRET_ACCESS_KEY, SES_REGION (Standard eu-central-1)
 * Die Namen beginnen bewusst nicht mit AWS_: Diese Namen reserviert Vercel.
 * Der IAM-Benutzer braucht nur ses:SendRawEmail, ses:SendEmail,
 * ses:GetAccount und ses:GetEmailIdentity.
 */

export const DEFAULT_SES_REGION = "eu-central-1";
const SES_TIMEOUT_MS = 15_000;

export interface SesEnv {
  region: string;
  credentials: AwsCredentials;
}

/** Zugangsdaten aus der Umgebung, oder null, wenn etwas fehlt. */
export function sesEnv(env: Record<string, string | undefined> = process.env): SesEnv | null {
  const accessKeyId = env.SES_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.SES_SECRET_ACCESS_KEY?.trim();
  if (!accessKeyId || !secretAccessKey) return null;
  const region = env.SES_REGION?.trim() || DEFAULT_SES_REGION;
  if (!/^[a-z]{2}(-[a-z]+)+-\d$/.test(region)) return null;
  return { region, credentials: { accessKeyId, secretAccessKey, sessionToken: env.SES_SESSION_TOKEN?.trim() || null } };
}

/**
 * Was ein Fehler für den Versand bedeutet:
 *  - "retry":     später erneut (Drosselung, Tageslimit, Netz, 5xx)
 *  - "recipient": nur dieser Empfänger geht nicht (Adresse abgelehnt)
 *  - "stop":      der ganze Versand muss anhalten (Konto, Domain, Rechte)
 */
export type SesErrorKind = "retry" | "recipient" | "stop";

export class SesError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly kind: SesErrorKind,
  ) {
    super(message);
    this.name = "SesError";
  }
}

const STOP_CODES = new Set([
  "AccountSuspendedException",
  "SendingPausedException",
  "MailFromDomainNotVerifiedException",
  "NotFoundException",
  "AccessDeniedException",
  "AccessDenied",
  "UnrecognizedClientException",
  "InvalidClientTokenId",
  "InvalidSignatureException",
  "SignatureDoesNotMatch",
  "IncompleteSignature",
  "MissingAuthenticationToken",
  "ExpiredToken",
  "ExpiredTokenException",
]);
const RETRY_CODES = new Set([
  "TooManyRequestsException",
  "ThrottlingException",
  "Throttling",
  "LimitExceededException",
  "InternalFailure",
  "ServiceUnavailable",
]);

/** Fehlercode aus Kopfzeile oder Antwort, z. B. "MessageRejected". */
export function sesErrorCode(headerType: string | null, body: unknown): string {
  const fromBody =
    body && typeof body === "object"
      ? ((body as Record<string, unknown>).__type ?? (body as Record<string, unknown>).code)
      : undefined;
  const raw = headerType || (typeof fromBody === "string" ? fromBody : "") || "";
  return raw.split(":")[0].split("#").pop()?.trim() || "";
}

const CREDENTIAL_CODES = new Set([
  "UnrecognizedClientException",
  "InvalidClientTokenId",
  "InvalidSignatureException",
  "SignatureDoesNotMatch",
  "IncompleteSignature",
  "MissingAuthenticationToken",
]);

/**
 * Fehler von SES als Satz für die Verwaltung: was passiert ist und was zu
 * tun ist. Unbekannte Fehler behalten die Meldung von AWS.
 */
export function sesErrorText(err: unknown): string {
  if (!(err instanceof SesError)) return err instanceof Error ? err.message : String(err);
  const c = err.code;
  if (CREDENTIAL_CODES.has(c)) return "Zugangsdaten ungültig · SES_ACCESS_KEY_ID und SES_SECRET_ACCESS_KEY in Vercel prüfen, danach neu deployen";
  if (c === "ExpiredToken" || c === "ExpiredTokenException") return "Zugangsdaten abgelaufen · neuen Schlüssel in Vercel eintragen";
  if (c === "AccessDeniedException" || c === "AccessDenied") return "Keine Berechtigung bei AWS · Richtlinie des IAM-Benutzers prüfen (ses:SendRawEmail, ses:GetAccount, ses:GetEmailIdentity)";
  if (c === "AccountSuspendedException") return "SES-Konto gesperrt · Nachricht von AWS im Konto lesen";
  if (c === "SendingPausedException") return "Versand bei AWS angehalten · im SES-Konto wieder freigeben";
  if (c === "MailFromDomainNotVerifiedException") return "MAIL-FROM-Domain bei AWS nicht bestätigt · DNS-Einträge (MX, SPF) prüfen";
  if (c === "NotFoundException") return "Bei AWS nicht gefunden · Absender-Domain und Konfigurationssatz in SES prüfen";
  if (c === "NotConfigured") return "SES ist nicht eingerichtet · Zugangsdaten und Absender fehlen";
  if (c === "NetworkError") return "SES nicht erreichbar · später erneut versuchen";
  if (c === "MessageRejected" && /not verified/i.test(err.message)) {
    return "Adresse oder Domain in SES nicht bestätigt · im Sandkasten gehen Mails nur an bestätigte Adressen";
  }
  if (c === "TooManyRequestsException" || c === "ThrottlingException" || c === "Throttling" || c === "LimitExceededException") {
    return "SES drosselt gerade · der Versand wird wiederholt";
  }
  return err.message;
}

export function classifySesError(status: number, code: string): SesErrorKind {
  if (STOP_CODES.has(code)) return "stop";
  if (RETRY_CODES.has(code) || status === 429 || status >= 500) return "retry";
  if (status === 403) return "stop";
  return "recipient";
}

async function sesCall<T>(
  env: SesEnv,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const url = new URL(`https://email.${env.region}.amazonaws.com${path}`);
  const payload = body === undefined ? "" : JSON.stringify(body);
  const headers = signAwsRequest({
    method,
    url,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: payload,
    region: env.region,
    service: "ses",
    credentials: env.credentials,
  });
  // host setzt fetch selbst; doppelt würde die Anfrage abgelehnt.
  delete headers.host;

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : payload,
      signal: AbortSignal.timeout(SES_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new SesError(`SES nicht erreichbar: ${msg}`, "NetworkError", 0, "retry");
  }

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const code = sesErrorCode(res.headers.get("x-amzn-errortype"), json) || `HTTP${res.status}`;
    const message =
      (json && typeof json === "object" && typeof (json as Record<string, unknown>).message === "string"
        ? ((json as Record<string, unknown>).message as string)
        : text.slice(0, 300)) || `HTTP ${res.status}`;
    throw new SesError(message, code, res.status, classifySesError(res.status, code));
  }
  return json as T;
}

export interface SesTag {
  Name: string;
  Value: string;
}

/** Eine fertige MIME-Nachricht senden. Liefert die SES-MessageId. */
export async function sesSendRaw(
  env: SesEnv,
  args: { from: string; to: string; raw: Buffer; configurationSet?: string | null; tags?: SesTag[] },
): Promise<string> {
  const result = await sesCall<{ MessageId?: string }>(env, "POST", "/v2/email/outbound-emails", {
    FromEmailAddress: args.from,
    Destination: { ToAddresses: [args.to] },
    Content: { Raw: { Data: args.raw.toString("base64") } },
    ...(args.configurationSet ? { ConfigurationSetName: args.configurationSet } : {}),
    ...(args.tags?.length ? { EmailTags: args.tags } : {}),
  });
  if (!result?.MessageId) throw new SesError("SES hat keine MessageId geliefert", "NoMessageId", 200, "retry");
  return result.MessageId;
}

export interface SesAccount {
  productionAccessEnabled: boolean;
  sendingEnabled: boolean;
  enforcementStatus: string | null;
  max24HourSend: number | null;
  maxSendRate: number | null;
  sentLast24Hours: number | null;
}

/** Konto-Zustand: Sandbox oder Produktivbetrieb, Kontingent, gesperrt? */
export async function sesGetAccount(env: SesEnv): Promise<SesAccount> {
  const a = await sesCall<{
    ProductionAccessEnabled?: boolean;
    SendingEnabled?: boolean;
    EnforcementStatus?: string;
    SendQuota?: { Max24HourSend?: number; MaxSendRate?: number; SentLast24Hours?: number };
  }>(env, "GET", "/v2/email/account");
  return {
    productionAccessEnabled: a?.ProductionAccessEnabled === true,
    sendingEnabled: a?.SendingEnabled !== false,
    enforcementStatus: a?.EnforcementStatus ?? null,
    max24HourSend: a?.SendQuota?.Max24HourSend ?? null,
    maxSendRate: a?.SendQuota?.MaxSendRate ?? null,
    sentLast24Hours: a?.SendQuota?.SentLast24Hours ?? null,
  };
}

export interface SesIdentity {
  verifiedForSending: boolean;
  dkimStatus: string | null;
  /** CNAME-Einträge für DKIM: <token>._domainkey.<domain> → <token>.dkim.amazonses.com */
  dkimTokens: string[];
  /** Eigene MAIL-FROM-Domain, z. B. mail.tuttenbrocksee.com */
  mailFromDomain: string | null;
  /** PENDING | SUCCESS | FAILED | TEMPORARY_FAILURE */
  mailFromStatus: string | null;
}

/** Zustand einer Domain oder Adresse in SES; null, wenn sie dort fehlt. */
export async function sesGetIdentity(env: SesEnv, identity: string): Promise<SesIdentity | null> {
  try {
    const r = await sesCall<{
      VerifiedForSendingStatus?: boolean;
      DkimAttributes?: { Status?: string; Tokens?: string[] };
      MailFromAttributes?: { MailFromDomain?: string; MailFromDomainStatus?: string };
    }>(env, "GET", `/v2/email/identities/${encodeURIComponent(identity)}`);
    return {
      verifiedForSending: r?.VerifiedForSendingStatus === true,
      dkimStatus: r?.DkimAttributes?.Status ?? null,
      dkimTokens: Array.isArray(r?.DkimAttributes?.Tokens) ? r!.DkimAttributes!.Tokens! : [],
      mailFromDomain: r?.MailFromAttributes?.MailFromDomain || null,
      mailFromStatus: r?.MailFromAttributes?.MailFromDomainStatus ?? null,
    };
  } catch (err) {
    if (err instanceof SesError && err.code === "NotFoundException") return null;
    throw err;
  }
}
