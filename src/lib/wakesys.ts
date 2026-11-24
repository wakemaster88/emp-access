/**
 * Wakesys API – Abfrage ob RFID/Code ein gültiges Ticket bei Wakesys hat.
 * Wird von der Scan-Route genutzt, wenn im eigenen System kein Ticket gefunden wird.
 */

import { createTtlCache } from "./ttl-cache";

type WakesysConfig = { baseUrl: string | null; extraConfig: string | null } | null;

type DbWithApiConfig = {
  apiConfig: { findFirst: (args: { where: { accountId: number; provider: string } }) => Promise<WakesysConfig> };
};

/**
 * Konfiguration je Account hoechstens 60 s im Speicher der Function: der
 * Scan-Weg fragt sie sonst bei jedem Scan neu ab. Aenderungen an der
 * Schnittstelle wirken damit spaetestens nach 60 s.
 */
const CONFIG_TTL_MS = 60_000;
const configCache = createTtlCache<WakesysConfig>(CONFIG_TTL_MS);

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

export type WakesysCheckResult =
  | { valid: true; interfaceId?: number; name?: string; picture?: string; age?: number }
  | { valid: false }
  | null;

/**
 * Prüft bei Wakesys, ob der Scan-Code ein gültiges Ticket hat.
 * Die Schnittstellen werden nacheinander gefragt, bis eine den Code kennt.
 * `timeoutMs`: Zeitlimit fuer alle Abrufe zusammen; ohne Angabe 10 s je
 * Abruf. Laeuft es ab, gilt der Code als ungueltig – wie bei jedem anderen
 * Fehler eines Abrufs.
 * @returns { valid: true, ... } wenn gültig, { valid: false } wenn ungültig, null wenn Wakesys nicht konfiguriert
 */
export async function checkWakesys(
  db: DbWithApiConfig,
  accountId: number,
  scan: string,
  opts: { timeoutMs?: number } = {},
): Promise<WakesysCheckResult> {
  const config = await configCache.get(String(accountId), () =>
    db.apiConfig.findFirst({
      where: { accountId, provider: "WAKESYS" },
    }),
  );
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

  const totalSignal =
    opts.timeoutMs != null ? AbortSignal.timeout(Math.max(1, opts.timeoutMs)) : null;

  try {
    for (const interfaceId of idsToTry) {
      const url = `https://${account}.wakesys.com/files_for_admin_and_browser/sql_query/query_operator.php?interface=gate&interface_id=${interfaceId}&controller_interface_type=${interfaceType}&id=${encodeURIComponent(scan)}`;

      const res = await fetch(url, { signal: totalSignal ?? AbortSignal.timeout(10000) });
      const data = await res.json();
      const value = data?.data?.value ?? null;

      if (isValueValid(value)) {
        const firstName = value?.col_first_name || "";
        const lastName = value?.col_last_name || "";
        const name = [firstName, lastName].filter(Boolean).join(" ") || undefined;
        const picture = value?.col_picture || undefined;
        const ageRaw = value?.col_age;
        const age = ageRaw ? parseInt(String(ageRaw), 10) : undefined;
        return { valid: true, interfaceId, name, picture, age: age && !isNaN(age) ? age : undefined };
      }
    }
    return { valid: false };
  } catch {
    return { valid: false };
  }
}
