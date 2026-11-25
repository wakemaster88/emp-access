import type { PrismaClient } from "@prisma/client";

/**
 * Schreibt Teile von `HubAgent.status` (z. B. `parking`, `snmp`, `system`)
 * in einer einzigen Anweisung: die genannten Schluessel der obersten Ebene
 * werden ersetzt, alle anderen bleiben so, wie sie in der Datenbank stehen.
 * Parallele Schreiber (Heartbeat, Parkplatz, Switch) ueberschreiben sich so
 * nicht gegenseitig. Ist `status` leer oder kein Objekt, entsteht ein neues
 * Objekt – wie bisher beim Lesen-und-Zusammenfuehren in JS.
 *
 * Die Zeile muss bereits existieren (vorher `upsert`). Felder mit
 * `undefined` fallen wie bei Prisma-JSON weg.
 */
export async function mergeHubAgentStatus(
  db: PrismaClient,
  accountId: number,
  name: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const json = JSON.stringify(patch);
  await db.$executeRaw`
    UPDATE "HubAgent"
    SET "status" = (CASE WHEN jsonb_typeof("status") = 'object' THEN "status" ELSE '{}'::jsonb END) || ${json}::jsonb
    WHERE "accountId" = ${accountId} AND "name" = ${name}
  `;
}
