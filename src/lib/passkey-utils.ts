/** Reine Hilfsfunktionen fuer Passkeys (ohne Datenbank, daher testbar). */

export interface RelyingParty {
  rpID: string;
  origin: string;
}

/**
 * Domain und Origin, fuer die der Passkey gilt. Standard ist der Host der
 * Anfrage (so funktionieren Produktion, Vorschau und localhost ohne Konfig);
 * WEBAUTHN_RP_ID und WEBAUTHN_ORIGIN legen sie fest, falls noetig.
 */
export function relyingPartyFrom(headers: Headers, env: Partial<Record<string, string>> = process.env): RelyingParty {
  const host = (headers.get("x-forwarded-host") ?? headers.get("host") ?? "localhost").split(",")[0].trim();
  const hostname = host.replace(/:\d+$/, "");
  const forwardedProto = headers.get("x-forwarded-proto")?.split(",")[0].trim();
  const proto = forwardedProto || (hostname === "localhost" || hostname === "127.0.0.1" ? "http" : "https");
  return {
    rpID: env.WEBAUTHN_RP_ID || hostname,
    origin: env.WEBAUTHN_ORIGIN || `${proto}://${host}`,
  };
}

/** Stabile Benutzerkennung im Authenticator (kein personenbezogener Wert). */
export function webauthnUserId(adminId: number): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`emp-admin-${adminId}`);
}

/** Vorschlag fuer den Namen eines neuen Passkeys aus dem User-Agent. */
export function suggestPasskeyName(userAgent: string | null): string {
  const ua = userAgent ?? "";
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return "Android";
  if (/Macintosh|Mac OS X/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Linux/i.test(ua)) return "Linux";
  return "Passkey";
}

export function cleanPasskeyName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/\s+/g, " ").trim().slice(0, 60);
  return name.length > 0 ? name : null;
}
