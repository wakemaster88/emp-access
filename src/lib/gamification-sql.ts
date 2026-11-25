import { Prisma } from "@prisma/client";
import type { startScanWhere } from "./gamification";

/**
 * Die Bedingung aus `startScanWhere` als SQL für rohe Abfragen auf `"Scan" s`
 * (Rückrechnung der Tagessummen in der Datenbank). Eigene Datei, weil
 * `gamification.ts` auch im Browser läuft und kein `@prisma/client` laden soll.
 * null, wenn kein Gerät als Start zählt.
 */
export function startScanSql(where: ReturnType<typeof startScanWhere>): Prisma.Sql | null {
  if (!where || where.OR.length === 0) return null;
  const parts = where.OR.map((c) => {
    const device =
      typeof c.deviceId === "number"
        ? Prisma.sql`s."deviceId" = ${c.deviceId}`
        : c.deviceId.in.length > 0
          ? Prisma.sql`s."deviceId" IN (${Prisma.join(c.deviceId.in)})`
          : Prisma.sql`FALSE`;
    return c.scanTime ? Prisma.sql`(${device} AND s."scanTime" < ${c.scanTime.lt})` : Prisma.sql`(${device})`;
  });
  return Prisma.join(parts, " OR ");
}
