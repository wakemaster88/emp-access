import { createHash, createHmac } from "node:crypto";

/**
 * AWS Signature Version 4 für einzelne HTTPS-Aufrufe (hier: Amazon SES v2).
 * Bewusst ohne AWS-SDK: Wir brauchen nur drei Aufrufe, und so kommt keine
 * neue Abhängigkeit ins Projekt. Ablauf nach
 * https://docs.aws.amazon.com/IAM/latest/UserGuide/create-signed-request.html
 */

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string | null;
}

export interface SignInput {
  method: string;
  url: URL;
  /** Zusätzliche Kopfzeilen, die mitsigniert werden (z. B. content-type). */
  headers?: Record<string, string>;
  body?: string;
  region: string;
  service: string;
  credentials: AwsCredentials;
  now?: Date;
}

function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/** URI-Kodierung nach RFC 3986, wie AWS sie verlangt (auch !'()*). */
export function awsUriEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * Kanonischer Pfad: Jedes Segment des (schon einmal kodierten) Pfads wird
 * erneut kodiert. Das verlangt SigV4 für alle Dienste außer S3.
 */
function canonicalPath(pathname: string): string {
  if (!pathname || pathname === "/") return "/";
  return pathname
    .split("/")
    .map((segment) => awsUriEncode(segment))
    .join("/");
}

function canonicalQuery(url: URL): string {
  const pairs: Array<[string, string]> = [];
  url.searchParams.forEach((value, key) => pairs.push([awsUriEncode(key), awsUriEncode(value)]));
  pairs.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1));
  return pairs.map(([k, v]) => `${k}=${v}`).join("&");
}

/** "20150830T123600Z" */
export function amzDate(now: Date): string {
  return now.toISOString().replace(/[:-]/g, "").replace(/\.\d{3}/, "");
}

/** Schlüssel für einen Tag, eine Region und einen Dienst. */
export function signingKey(secretAccessKey: string, date: string, region: string, service: string): Buffer {
  const kDate = hmac(`AWS4${secretAccessKey}`, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

/**
 * Liefert alle Kopfzeilen für den Aufruf, inklusive `authorization`,
 * `x-amz-date` und `host`. Der Aufrufer schickt genau diese Kopfzeilen mit.
 */
export function signAwsRequest(input: SignInput): Record<string, string> {
  const now = input.now ?? new Date();
  const stamp = amzDate(now);
  const date = stamp.slice(0, 8);
  const body = input.body ?? "";

  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.headers ?? {})) headers[k.toLowerCase()] = v;
  headers.host = input.url.host;
  headers["x-amz-date"] = stamp;
  if (input.credentials.sessionToken) headers["x-amz-security-token"] = input.credentials.sessionToken;

  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n].trim().replace(/\s+/g, " ")}\n`).join("");
  const signedHeaders = names.join(";");

  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalPath(input.url.pathname),
    canonicalQuery(input.url),
    canonicalHeaders,
    signedHeaders,
    sha256Hex(body),
  ].join("\n");

  const scope = `${date}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256Hex(canonicalRequest)].join("\n");
  const signature = createHmac("sha256", signingKey(input.credentials.secretAccessKey, date, input.region, input.service))
    .update(stringToSign, "utf8")
    .digest("hex");

  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return headers;
}
