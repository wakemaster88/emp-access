import type { TenantDb } from "./prisma";

/**
 * Prueft Fremdschluessel aus dem Request gegen den Mandanten.
 *
 * Die Mandanten-Erweiterung (`tenantClient`) filtert nur die oberste Ebene
 * einer Abfrage. IDs, die als Fremdschluessel oder in verschachtelten
 * `connect`/`create`-Bloecken gespeichert werden, sieht sie nicht - ohne
 * diese Pruefung liessen sich Bereiche, Abos, Geraete oder Tickets eines
 * anderen Mandanten an eigene Datensaetze haengen und ueber `include`
 * wieder auslesen.
 */
export type TenantRefs = {
  accessAreaIds?: Array<number | null | undefined>;
  subscriptionIds?: Array<number | null | undefined>;
  serviceIds?: Array<number | null | undefined>;
  vereinIds?: Array<number | null | undefined>;
  deviceIds?: Array<number | null | undefined>;
};

const LABELS: Record<keyof TenantRefs, string> = {
  accessAreaIds: "Bereich",
  subscriptionIds: "Abo",
  serviceIds: "Ticket-Typ",
  vereinIds: "Verein",
  deviceIds: "Gerät",
};

/** Eindeutige, gueltige IDs einer Liste (null/undefined/NaN fallen weg). */
export function cleanIds(ids: Array<number | null | undefined> | undefined): number[] {
  if (!ids) return [];
  const out = new Set<number>();
  for (const id of ids) {
    if (typeof id === "number" && Number.isInteger(id)) out.add(id);
  }
  return [...out];
}

/** IDs aus `requested`, die in `found` fehlen. */
export function missingIds(requested: number[], found: number[]): number[] {
  const have = new Set(found);
  return requested.filter((id) => !have.has(id));
}

/**
 * Liefert eine Fehlermeldung, wenn eine der IDs nicht zum Mandanten gehoert
 * (oder nicht existiert), sonst null.
 *
 * `accountId` ist nur bei Super-Admins leer; fuer sie gilt wie ueberall der
 * ungefilterte Zugriff, geprueft wird dann nur die Existenz.
 */
export async function foreignRefError(
  db: TenantDb,
  accountId: number | null | undefined,
  refs: TenantRefs,
): Promise<string | null> {
  const scope = accountId != null ? { accountId } : {};
  const lookups: Record<keyof TenantRefs, (ids: number[]) => Promise<{ id: number }[]>> = {
    accessAreaIds: (ids) => db.accessArea.findMany({ where: { id: { in: ids }, ...scope }, select: { id: true } }),
    subscriptionIds: (ids) => db.subscription.findMany({ where: { id: { in: ids }, ...scope }, select: { id: true } }),
    serviceIds: (ids) => db.service.findMany({ where: { id: { in: ids }, ...scope }, select: { id: true } }),
    vereinIds: (ids) => db.verein.findMany({ where: { id: { in: ids }, ...scope }, select: { id: true } }),
    deviceIds: (ids) => db.device.findMany({ where: { id: { in: ids }, ...scope }, select: { id: true } }),
  };

  const kinds = (Object.keys(lookups) as Array<keyof TenantRefs>).filter(
    (kind) => cleanIds(refs[kind]).length > 0,
  );
  const results = await Promise.all(
    kinds.map(async (kind) => {
      const ids = cleanIds(refs[kind]);
      const found = await lookups[kind](ids);
      return { kind, missing: missingIds(ids, found.map((row) => row.id)) };
    }),
  );
  const bad = results.find((r) => r.missing.length > 0);
  if (!bad) return null;
  return `${LABELS[bad.kind]} nicht gefunden (ID ${bad.missing.join(", ")}).`;
}
