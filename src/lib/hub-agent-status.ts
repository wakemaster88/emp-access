import { Prisma, type PrismaClient } from "@prisma/client";
import { mergeHubStatus } from "./hub-status";

/**
 * Schreibt eine Meldung des Hubs (Heartbeat, Parkplatz, Switch) in
 * `HubAgent` in einer einzigen Anweisung: Fehlt die Zeile, wird sie
 * angelegt (`INSERT … ON CONFLICT`), sonst werden nur die Schluessel der
 * obersten Ebene aus `patch` in `status` ersetzt und `lastSeenAt` gesetzt.
 * Alle anderen Schluessel bleiben so, wie sie in der Datenbank stehen:
 * Gleichzeitige Meldungen ueberschreiben sich nicht gegenseitig, und der
 * Status wird weder gelesen noch zurueckgeliefert (nur die id).
 *
 * Das Ergebnis ist dasselbe wie `mergeHubStatus(status, patch)` in
 * `hub-status.ts`: Ist `status` leer oder kein Objekt, entsteht ein neues
 * Objekt; steht unter `snmp.switches` noch die fruehere Fassung mit
 * Port-Listen und MAC-Tabellen, wird sie durch die Kurzfassung
 * (`snmpStatusSummary`) ersetzt. Felder mit `undefined` fallen wie bei JSON
 * weg. Der Patch selbst wird vorher mit denselben Regeln aufbereitet, die
 * Datenbank wendet sie auf den gespeicherten Stand an.
 *
 * `agent` (nur der Heartbeat): Rechnername, Version und Module der Zeile;
 * `modules` undefined laesst den gespeicherten Wert stehen.
 */
export async function writeHubAgentStatus(
  db: PrismaClient,
  accountId: number,
  name: string,
  patch: Record<string, unknown>,
  agent?: { hostname: string | null; version: string | null; modules: unknown },
): Promise<number> {
  const json = JSON.stringify(mergeHubStatus(null, patch));
  const modules = agent?.modules === undefined || agent.modules === null ? null : JSON.stringify(agent.modules);
  const rows = await db.$queryRaw<Array<{ id: number }>>`
    INSERT INTO "HubAgent" ("name", "accountId", "status", "lastSeenAt", "updatedAt"${agent ? AGENT_COLUMNS : Prisma.empty})
    VALUES (
      ${name}, ${accountId}, ${json}::jsonb, (now() AT TIME ZONE 'UTC'), (now() AT TIME ZONE 'UTC')
      ${agent ? Prisma.sql`, ${agent.hostname}, ${agent.version}, ${modules}::jsonb` : Prisma.empty}
    )
    ON CONFLICT ("accountId", "name") DO UPDATE SET
      "status" = ${mergedStatus(json)},
      "lastSeenAt" = EXCLUDED."lastSeenAt",
      "updatedAt" = EXCLUDED."updatedAt"
      ${agent ? AGENT_UPDATE : Prisma.empty}
    WHERE "HubAgent"."accountId" = ${accountId}
    RETURNING "id"
  `;
  return rows[0]?.id ?? 0;
}

const AGENT_COLUMNS = Prisma.sql`, "hostname", "version", "modules"`;
const AGENT_UPDATE = Prisma.sql`,
      "hostname" = EXCLUDED."hostname",
      "version" = EXCLUDED."version",
      "modules" = COALESCE(EXCLUDED."modules", "HubAgent"."modules")`;

/**
 * Kurzfassung eines Switches `e` (Element von snmp.switches), wie
 * `snmpStatusSummary`: Anzahl Ports, verbundene Ports und MAC-Eintraege;
 * schon gekuerzte Zahlen bleiben.
 */
const SWITCH_SUMMARY = Prisma.sql`jsonb_build_object(
  'host', CASE WHEN jsonb_typeof(e -> 'host') = 'string' THEN e -> 'host' ELSE '""'::jsonb END,
  'sysName', CASE WHEN jsonb_typeof(e -> 'sysName') = 'string' THEN e -> 'sysName' ELSE 'null'::jsonb END,
  'polledAt', CASE WHEN jsonb_typeof(e -> 'polledAt') = 'string' THEN e -> 'polledAt' ELSE 'null'::jsonb END,
  'ports', CASE
    WHEN jsonb_typeof(e -> 'ports') = 'array' THEN to_jsonb(jsonb_array_length(e -> 'ports'))
    WHEN jsonb_typeof(e -> 'ports') = 'number' THEN e -> 'ports'
    ELSE '0'::jsonb END,
  'portsUp', CASE
    WHEN jsonb_typeof(e -> 'ports') = 'array'
      THEN to_jsonb((SELECT count(*) FROM jsonb_array_elements(e -> 'ports') AS p(v) WHERE p.v -> 'up' = 'true'::jsonb))
    WHEN jsonb_typeof(e -> 'portsUp') = 'number' THEN e -> 'portsUp'
    ELSE '0'::jsonb END,
  'macs', CASE
    WHEN jsonb_typeof(e -> 'macTable') = 'array' THEN to_jsonb(jsonb_array_length(e -> 'macTable'))
    WHEN jsonb_typeof(e -> 'macs') = 'number' THEN e -> 'macs'
    ELSE '0'::jsonb END,
  'error', CASE WHEN jsonb_typeof(e -> 'error') = 'string' THEN e -> 'error' ELSE 'null'::jsonb END
)`;

/** Bestehender Status der Zeile, zusammengefuehrt mit dem Patch (Parameter, nie Text in der Anweisung). */
function mergedStatus(json: string): Prisma.Sql {
  return Prisma.sql`(
    SELECT CASE
      WHEN jsonb_typeof(m -> 'snmp' -> 'switches') = 'array'
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(m -> 'snmp' -> 'switches') AS d(e)
          WHERE jsonb_typeof(e -> 'ports') = 'array' OR jsonb_typeof(e -> 'macTable') = 'array'
        )
      THEN jsonb_set(m, '{snmp,switches}', (
        SELECT coalesce(jsonb_agg(${SWITCH_SUMMARY} ORDER BY x.o), '[]'::jsonb)
        FROM jsonb_array_elements(m -> 'snmp' -> 'switches') WITH ORDINALITY AS x(e, o)
        WHERE jsonb_typeof(x.e) = 'object'
      ))
      ELSE m
    END
    FROM (
      SELECT (CASE WHEN jsonb_typeof("HubAgent"."status") = 'object' THEN "HubAgent"."status" ELSE '{}'::jsonb END)
        || ${json}::jsonb AS m
    ) AS merged
  )`;
}
