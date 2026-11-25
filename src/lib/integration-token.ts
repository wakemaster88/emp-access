import { createHash, randomBytes } from "node:crypto";

/**
 * Integrations-Tokens fuer angebundene Systeme (emp-control, Website,
 * Fundsachen-Dienste). Anders als das Account-Token gilt ein solches Token
 * nur fuer die Routen seiner Scopes und nur als `Authorization: Bearer`.
 * Die Pruefung gegen die Datenbank steht in `validateApiOrIntegrationToken`
 * (src/lib/api-auth.ts); hier liegen die reinen Helfer.
 */

export * from "./integration-scopes";

const TOKEN_PREFIX = "int_";

/** Neues Integrations-Token: `int_` + 43 Zeichen aus dem CSPRNG. */
export function newIntegrationToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/** Sieht der Wert aus wie ein von `newIntegrationToken` erzeugtes Token? */
export function looksLikeIntegrationToken(token: string): boolean {
  return /^int_[A-Za-z0-9_-]{43}$/.test(token);
}

export function hashIntegrationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Sichtbarer Anfang fuer die Liste, z. B. `int_AbCd…`. */
export function integrationTokenPrefix(token: string): string {
  return `${token.slice(0, TOKEN_PREFIX.length + 4)}…`;
}

/** Token aus `Authorization: Bearer …`; sonst null. */
export function bearerToken(headers: Headers): string | null {
  const m = headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : null;
}

/** lastUsedAt hoechstens einmal pro Minute schreiben. */
export const INTEGRATION_LAST_USED_EVERY_MS = 60_000;

export function integrationLastUsedDue(lastUsedAt: Date | null, now = Date.now()): boolean {
  return !lastUsedAt || now - lastUsedAt.getTime() >= INTEGRATION_LAST_USED_EVERY_MS;
}
