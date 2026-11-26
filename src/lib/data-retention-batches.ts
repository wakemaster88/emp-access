/**
 * Löschen in Portionen für die Teil-Fristen („Unbekannte Personen“,
 * „Scan-Fotos“) ohne eigene Datenbank-Anbindung: Abfragen, Löschen der
 * Zeilen und der Blobs bekommt die Funktion vom Aufrufer
 * (`purgeAccountRetention` in data-retention.ts). So lässt sich der Ablauf
 * mit Attrappen prüfen; die Größen und Grenzen stehen in
 * data-retention-rules.ts.
 */
import type { RetentionKey } from "@/lib/data-retention-config";
import { nextBatchSize, retentionRestLine } from "@/lib/data-retention-rules";

/** Zeitbudget der Schritte in Portionen, für alle Konten eines Laufs gemeinsam. */
export type RetentionBudget = { untilMs: number };

/** Eine Portion: Zeile und ihr Bild im Blob-Speicher (falls vorhanden). */
export type BatchRow = { id: number; blob: string | null };

export interface BatchOps {
  /** Die ältesten fälligen Zeilen, höchstens `take`. */
  find: (take: number) => Promise<BatchRow[]>;
  /** Diese Zeilen löschen, mit der vollen Bedingung; Anzahl gelöscht. */
  remove: (ids: number[]) => Promise<number>;
  /** Welche dieser Zeilen es noch gibt. */
  existing: (ids: number[]) => Promise<number[]>;
  /** Wie viele Zeilen noch fällig sind. */
  count: () => Promise<number>;
  /** Blobs der gelöschten Zeilen entfernen. */
  dropBlobs: (pathnames: Array<string | null>) => Promise<unknown>;
  /** Uhr (ms), ohne Angabe Date.now. */
  now?: () => number;
  /** Log-Zeile, ohne Angabe console.log. */
  log?: (line: string) => void;
}

/**
 * Löscht in Portionen über die IDs, älteste zuerst, höchstens bis zur
 * Obergrenze je Lauf und solange das Zeitbudget reicht (`nextBatchSize`).
 * Gelöscht wird jede Portion mit der vollen Bedingung; Blob-Pfade nur von
 * Zeilen, die dabei wirklich verschwunden sind (z. B. nicht von einer
 * Sichtung, die zwischendurch einer Person zugeordnet wurde). Hört der
 * Schritt vor dem Ende auf, steht der Rest in `remaining` und im Log.
 */
export async function deleteInBatches(
  accountId: number,
  key: RetentionKey,
  budget: RetentionBudget,
  remaining: Partial<Record<RetentionKey, number>>,
  ops: BatchOps
): Promise<number> {
  const now = ops.now ?? Date.now;
  let deleted = 0;
  for (;;) {
    const take = nextBatchSize({ deleted, nowMs: now(), untilMs: budget.untilMs });
    if (take === 0) break;
    const rows = await ops.find(take);
    if (rows.length === 0) return deleted;
    const ids = rows.map((r) => r.id);
    const n = await ops.remove(ids);
    let gone = rows;
    if (n !== ids.length) {
      const kept = new Set(await ops.existing(ids));
      gone = rows.filter((r) => !kept.has(r.id));
    }
    await ops.dropBlobs(gone.map((r) => r.blob));
    deleted += n;
    if (rows.length < take) return deleted;
    if (n === 0) break;
  }
  const rest = await ops.count();
  if (rest > 0) {
    remaining[key] = rest;
    (ops.log ?? console.log)(retentionRestLine(accountId, key, deleted, rest));
  }
  return deleted;
}
