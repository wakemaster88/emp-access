/**
 * Wakesys API – Abfrage ob RFID/Code ein gültiges Ticket bei Wakesys hat.
 * Wird von der Scan-Route genutzt, wenn im eigenen System kein Ticket gefunden wird.
 */

type DbWithApiConfig = {
  apiConfig: { findFirst: (args: { where: { accountId: number; provider: string } }) => Promise<{ baseUrl: string | null; extraConfig: string | null } | null> };
};

export function isValueValid(value: { card_valid?: string; next_tickets?: unknown[]; valid_until?: string } | null): boolean {
  if (!value) return false;
  if (value.card_valid === "yes") return true;
  if (Array.isArray(value.next_tickets) && value.next_tickets.length > 0) return true;
  if (value.valid_until != null && value.valid_until !== "") {
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    if (String(value.valid_until) >= currentTime) return true;
  }
  return false;
}

export type WakesysCheckResult = { valid: true; interfaceId?: number } | { valid: false } | null;

/**
 * Prüft bei Wakesys, ob der Scan-Code ein gültiges Ticket hat.
 * @returns { valid: true } wenn gültig, { valid: false } wenn ungültig, null wenn Wakesys nicht konfiguriert
 */
export async function checkWakesys(
  db: DbWithApiConfig,
  accountId: number,
  scan: string
): Promise<WakesysCheckResult> {
  const config = await db.apiConfig.findFirst({
    where: { accountId, provider: "WAKESYS" },
  });
  if (!config) return null;

  const extraConfig = config.extraConfig ? JSON.parse(config.extraConfig) : {};
  const account =
    extraConfig.account ||
    (config.baseUrl ? new URL(config.baseUrl).hostname.split(".")[0] : null) ||
    "default";
  const interfaceType = extraConfig.interfaceType || "gate";
  const interfaceIds: number[] = Array.isArray(extraConfig.interfaceIds)
    ? extraConfig.interfaceIds
    : extraConfig.interfaceId != null
      ? [Number(extraConfig.interfaceId)]
      : [2];

  const idsToTry = interfaceIds.length > 0 ? interfaceIds : [2];

  try {
    for (const interfaceId of idsToTry) {
      const url = `https://${account}.wakesys.com/files_for_admin_and_browser/sql_query/query_operator.php?interface=gate&interface_id=${interfaceId}&controller_interface_type=${interfaceType}&id=${encodeURIComponent(scan)}`;

      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      const data = await res.json();
      const value = data?.data?.value ?? null;

      if (isValueValid(value)) {
        return { valid: true, interfaceId };
      }
    }
    return { valid: false };
  } catch {
    return { valid: false };
  }
}
