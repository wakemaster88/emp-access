import { prisma } from "@/lib/prisma";
import { isPlausibleCountToken } from "@/lib/warenwirtschaft";

/**
 * Gültigen Zähl-Link eines Inventar-Blatts laden (öffentliche Handy-Seite).
 * Liefert `null` für unbekannte und `"EXPIRED"` für abgelaufene Links.
 */
export async function loadInventoryLink(token: string) {
  if (!isPlausibleCountToken(token)) return null;
  const link = await prisma.inventoryCountLink.findUnique({
    where: { token },
    select: { accountId: true, group: true, year: true, expiresAt: true, account: { select: { name: true } } },
  });
  if (!link) return null;
  if (link.expiresAt.getTime() <= Date.now()) return "EXPIRED" as const;
  return link;
}

export const LINK_GONE = {
  NONE: "Dieser Link ist nicht mehr gültig.",
  EXPIRED: "Dieser Link ist abgelaufen. Bitte einen neuen Link anfordern.",
} as const;

/** Gruppe eines Links, der für alle Blätter des Inventars gilt. */
export const ALL_GROUPS = "*";

/** Prisma-Filter auf das Blatt des Links (alle Blätter bei `ALL_GROUPS`). */
export function groupFilter(group: string): { group?: string } {
  return group === ALL_GROUPS ? {} : { group };
}
