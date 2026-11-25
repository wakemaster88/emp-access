import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { TenantDb } from "./prisma";
import { ROLE_LABEL, canonicalContent, lineChanges, type ContentLine, type LineField, type StocktakeEventType } from "./stocktake-log";

/**
 * Protokoll und Bestätigungen einer Inventur in der Datenbank. Läuft mit dem
 * Mandanten-Client oder (Zähl-Link ohne Login) mit dem rohen Client; die
 * Aufrufer geben `accountId` immer mit.
 */

export interface Actor {
  name: string;
  adminId?: number | null;
  via: "app" | "link" | "system";
}

export interface EventInput {
  type: StocktakeEventType;
  lineId?: number | null;
  lineName?: string | null;
  field?: LineField | null;
  oldValue?: number | null;
  newValue?: number | null;
  note?: string | null;
}

export function hashContent(lines: ContentLine[]): string {
  return createHash("sha256").update(canonicalContent(lines)).digest("hex");
}

/** Aktuelle Prüfsumme der Zählliste einer Inventur. */
export async function stocktakeHash(db: TenantDb, stocktakeId: number, accountId: number): Promise<string> {
  const lines = await db.stocktakeLine.findMany({
    where: { stocktakeId, accountId },
    select: { id: true, counted: true, broken: true, purchasePriceCents: true },
  });
  return hashContent(lines);
}

export async function logEvents(db: TenantDb, stocktakeId: number, accountId: number, actor: Actor, events: EventInput[]) {
  if (events.length === 0) return;
  await db.stocktakeEvent.createMany({
    data: events.map((e) => ({
      accountId,
      stocktakeId,
      type: e.type,
      lineId: e.lineId ?? null,
      lineName: e.lineName?.slice(0, 200) ?? null,
      field: e.field ?? null,
      oldValue: e.oldValue ?? null,
      newValue: e.newValue ?? null,
      actor: actor.name.slice(0, 120) || "Unbekannt",
      adminId: actor.adminId ?? null,
      via: actor.via,
      note: e.note?.slice(0, 1000) ?? null,
    })),
  });
}

/**
 * Hebt Bestätigungen auf, nachdem sich die Liste geändert hat. Ohne Grund
 * (`onlyStale`) nur die, deren Prüfsumme nicht mehr zum Inhalt passt.
 */
export async function voidSignatures(db: TenantDb, stocktakeId: number, accountId: number, actor: Actor, onlyStale = false) {
  const sigs = await db.stocktakeSignature.findMany({
    where: { stocktakeId, accountId },
    select: { id: true, role: true, name: true, contentHash: true },
  });
  if (sigs.length === 0) return 0;
  const current = onlyStale ? await stocktakeHash(db, stocktakeId, accountId) : null;
  const stale = current ? sigs.filter((s) => s.contentHash !== current) : sigs;
  if (stale.length === 0) return 0;
  await db.stocktakeSignature.deleteMany({ where: { id: { in: stale.map((s) => s.id) }, accountId } });
  await logEvents(
    db,
    stocktakeId,
    accountId,
    actor,
    stale.map((s) => ({
      type: "SIGNATURE_VOID" as const,
      note: `Bestätigung als ${ROLE_LABEL[s.role]} von ${s.name} aufgehoben, weil die Liste danach geändert wurde`,
    })),
  );
  return stale.length;
}

type Patch = { id: number } & Partial<Record<LineField, number | null | undefined>>;

/**
 * Speichert Mengen einer offenen Inventur und protokolliert jede echte
 * Änderung mit altem und neuem Wert. Bestätigungen werden danach aufgehoben.
 * Geschrieben wird je Zeile nur, solange die Inventur noch offen ist; was
 * nach dem Festschreiben ankommt, bleibt unverändert und ohne Protokoll.
 * `extra` setzt zusätzliche Felder je Zeile (z. B. `countedBy`).
 */
export async function applyLineChanges(
  db: TenantDb,
  stocktakeId: number,
  accountId: number,
  actor: Actor,
  patches: Patch[],
  extra: { countedBy?: string } = {},
): Promise<number> {
  if (patches.length === 0) return 0;
  const before = await db.stocktakeLine.findMany({
    where: { stocktakeId, accountId, id: { in: patches.map((p) => p.id) } },
    select: { id: true, name: true, counted: true, broken: true, purchasePriceCents: true },
  });
  const byId = new Map(before.map((l) => [l.id, l]));
  const events: EventInput[] = [];
  for (const p of patches) {
    const old = byId.get(p.id);
    if (!old) continue;
    const changes = lineChanges(old, p);
    if (changes.length === 0) continue;
    const data: Record<string, number | null | string> = { ...extra };
    for (const c of changes) data[c.field] = c.newValue;
    // Der Status wird mit FOR SHARE gelesen: läuft gerade das Festschreiben,
    // wartet die Anweisung darauf und sieht danach CLOSED.
    const sets = Object.entries(data).map(([k, v]) => Prisma.sql`${Prisma.raw(`"${k}"`)} = ${v}`);
    const count = await db.$executeRaw`
      UPDATE "StocktakeLine"
      SET ${Prisma.join(sets)}, "updatedAt" = (now() AT TIME ZONE 'UTC')
      WHERE "id" = ${p.id}
        AND "stocktakeId" = ${stocktakeId}
        AND "accountId" = ${accountId}
        AND EXISTS (
          SELECT 1 FROM "Stocktake"
          WHERE "id" = ${stocktakeId} AND "accountId" = ${accountId} AND "status" = 'OPEN'
          FOR SHARE
        )`;
    if (count === 0) continue;
    for (const c of changes) events.push({ type: "COUNT", lineId: p.id, lineName: old.name, ...c });
  }
  await logEvents(db, stocktakeId, accountId, actor, events);
  if (events.length > 0) await voidSignatures(db, stocktakeId, accountId, actor);
  return events.length;
}
