/**
 * Binarytec API – Zugriffskontrolle (api_binarytec.php).
 * - Check: POST {baseUrl}/api/v1/raspi/access-controls/check-access
 *   Body: { resourceId, acNumber }, Header: Authorization Bearer {token}
 *   Gültig wenn response.success === 1
 * - Optional: gone-in/gone-out unter .../gone-{inout} mit gleichem Body
 */

import { createTtlCache } from "./ttl-cache";

type BinarytecConfig = {
  baseUrl: string | null;
  token: string;
  extraConfig: string | null;
} | null;

type DbWithApiConfig = {
  apiConfig: {
    findFirst: (args: { where: { accountId: number; provider: string } }) => Promise<{
      baseUrl: string | null;
      token: string;
      extraConfig: string | null;
    } | null>;
  };
};

/**
 * Konfiguration je Account hoechstens 60 s im Speicher der Function: der
 * Scan-Weg fragt sie sonst bei jedem Scan neu ab. Aenderungen an der
 * Schnittstelle wirken damit spaetestens nach 60 s.
 */
const CONFIG_TTL_MS = 60_000;
const configCache = createTtlCache<BinarytecConfig>(CONFIG_TTL_MS);

export type BinarytecCheckResult = { valid: true } | { valid: false } | null;

/**
 * Prüft bei Binarytec, ob der Scan-Code (acNumber) an der Ressource (resourceId) Zutritt hat.
 * `timeoutMs`: Zeitlimit fuer den Abruf (Standard 10 s). Laeuft es ab, gilt
 * der Code als ungueltig – wie bei jedem anderen Fehler des Abrufs.
 * @returns { valid: true } wenn gültig, { valid: false } wenn ungültig, null wenn nicht konfiguriert oder resourceId fehlt
 */
export async function checkBinarytec(
  db: DbWithApiConfig,
  accountId: number,
  scan: string,
  opts: { timeoutMs?: number } = {},
): Promise<BinarytecCheckResult> {
  const config = await configCache.get(String(accountId), () =>
    db.apiConfig.findFirst({
      where: { accountId, provider: "BINARYTEC" },
    }),
  );
  if (!config?.token?.trim() || !config.baseUrl?.trim()) return null;

  const extraConfig = config.extraConfig ? JSON.parse(config.extraConfig) : {};
  const resourceId = extraConfig.resourceId ?? extraConfig.resource_id;
  if (resourceId == null || String(resourceId).trim() === "") return null;

  const baseUrl = config.baseUrl.replace(/\/$/, "");
  const url = `${baseUrl}/api/v1/raspi/access-controls/check-access`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.token.trim()}`,
      },
      body: JSON.stringify({
        resourceId: String(resourceId).trim(),
        acNumber: String(scan).trim(),
      }),
      signal: AbortSignal.timeout(Math.max(1, opts.timeoutMs ?? 10000)),
    });

    const data = await res.json();
    const success = data?.success === 1 || data?.success === true;
    return success ? { valid: true } : { valid: false };
  } catch {
    return { valid: false };
  }
}
