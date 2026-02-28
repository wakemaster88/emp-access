/**
 * Binarytec API – Zugriffskontrolle (api_binarytec.php).
 * - Check: POST {baseUrl}/api/v1/raspi/access-controls/check-access
 *   Body: { resourceId, acNumber }, Header: Authorization Bearer {token}
 *   Gültig wenn response.success === 1
 * - Optional: gone-in/gone-out unter .../gone-{inout} mit gleichem Body
 */

type DbWithApiConfig = {
  apiConfig: {
    findFirst: (args: { where: { accountId: number; provider: string } }) => Promise<{
      baseUrl: string | null;
      token: string;
      extraConfig: string | null;
    } | null>;
  };
};

export type BinarytecCheckResult = { valid: true } | { valid: false } | null;

/**
 * Prüft bei Binarytec, ob der Scan-Code (acNumber) an der Ressource (resourceId) Zutritt hat.
 * @returns { valid: true } wenn gültig, { valid: false } wenn ungültig, null wenn nicht konfiguriert oder resourceId fehlt
 */
export async function checkBinarytec(
  db: DbWithApiConfig,
  accountId: number,
  scan: string
): Promise<BinarytecCheckResult> {
  const config = await db.apiConfig.findFirst({
    where: { accountId, provider: "BINARYTEC" },
  });
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
      signal: AbortSignal.timeout(10000),
    });

    const data = await res.json();
    const success = data?.success === 1 || data?.success === true;
    return success ? { valid: true } : { valid: false };
  } catch {
    return { valid: false };
  }
}
