/**
 * Löschfristen als reine Regeln (ohne Datenbank, damit testbar): welcher
 * Schlüssel einen Lösch-Schritt bekommt, mit welchem Stichtag und unter
 * welcher Bedingung, und wie weit ein Schritt in Portionen pro Lauf geht.
 * Das Löschen selbst steht in `data-retention.ts`.
 */
import type { Prisma } from "@prisma/client";
import {
  RETENTION_KEYS,
  RETENTION_PARENT,
  cutoffDate,
  isSubRetentionKey,
  type DataRetentionConfig,
  type RetentionKey,
} from "./data-retention-config";

/**
 * Stichtag je Schlüssel mit eigenem Lösch-Schritt: gelöscht wird, was älter
 * ist. Ein Schlüssel ohne Eintrag hat keinen Schritt.
 *
 * Bisherige Schlüssel: Stichtag aus ihrer Frist, null = unbegrenzt.
 * Teil-Fristen (`RETENTION_PARENT`): nur ein eigener Schritt, wenn ein Wert
 * gesetzt ist und er kürzer ist als die übergeordnete Frist (oder diese
 * unbegrenzt ist). Bei null, gleicher oder längerer Frist löscht allein der
 * Schritt des übergeordneten Schlüssels, genau wie ohne die Teil-Frist –
 * eine längere Teil-Frist verlängert nichts.
 */
export function retentionCutoffs(
  config: DataRetentionConfig,
  now: Date,
): Partial<Record<RetentionKey, Date>> {
  const out: Partial<Record<RetentionKey, Date>> = {};
  for (const key of RETENTION_KEYS) {
    const days = config[key];
    if (days == null) continue;
    if (isSubRetentionKey(key)) {
      const parentDays = config[RETENTION_PARENT[key]];
      if (parentDays != null && days >= parentDays) continue;
    }
    out[key] = cutoffDate(days, now);
  }
  return out;
}

/* ---------------------------------------- Bedingungen der Lösch-Schritte */

/** Personen-Sichtungen (Frist „Personen“): alle Sichtungen, zugeordnet oder nicht. */
export function personSightingsWhere(accountId: number, cutoff: Date): Prisma.PersonSightingWhereInput {
  return { accountId, seenAt: { lt: cutoff } };
}

/**
 * Sichtungen ohne zugeordnete Person (Frist „Unbekannte Personen“). Gesperrte
 * und deaktivierte Personen sind zugeordnet (`listedPersonId` gesetzt) und
 * fallen nicht darunter.
 */
export function unknownSightingsWhere(accountId: number, cutoff: Date): Prisma.PersonSightingWhereInput {
  return { accountId, listedPersonId: null, seenAt: { lt: cutoff } };
}

/** Scans (Frist „Scans“); ihre Fotos verschwinden per Cascade mit. */
export function scansWhere(accountId: number, cutoff: Date): Prisma.ScanWhereInput {
  return { accountId, scanTime: { lt: cutoff } };
}

/** Fotos der Scans, die der Scans-Schritt per Cascade mitnimmt: nur die im Blob-Speicher, für deren Pfade. */
export function scanSnapshotBlobsWhere(accountId: number, cutoff: Date): Prisma.ScanSnapshotWhereInput {
  return { accountId, blobPathname: { not: null }, scan: { scanTime: { lt: cutoff } } };
}

/** Fotos der Scans (Frist „Scan-Fotos“): nach dem Aufnahmezeitpunkt; der Scan-Eintrag bleibt. */
export function scanSnapshotsWhere(accountId: number, cutoff: Date): Prisma.ScanSnapshotWhereInput {
  return { accountId, capturedAt: { lt: cutoff } };
}

/* ------------------------------------------------- Löschen in Portionen */

/** Zeilen je Portion (über ihre IDs). */
export const RETENTION_BATCH = 500;
/** Höchstens so viele Zeilen je Schritt und Lauf; der Rest folgt im nächsten Lauf. */
export const RETENTION_MAX_ROWS = 2_000;
/**
 * Zeitbudget aller Portionen eines Laufs (alle Konten zusammen). Der Cron
 * hat 300 s; danach folgen noch Blob-Aufräumen und Telegram-Prüfung.
 */
export const RETENTION_BUDGET_MS = 90_000;

/**
 * Größe der nächsten Portion; 0 = aufhören (Obergrenze des Laufs erreicht
 * oder Zeitbudget verbraucht). Wie viele Zeilen noch übrig sind, sagt der
 * Aufrufer danach selbst (Zählung).
 */
export function nextBatchSize(opts: {
  /** In diesem Schritt schon gelöscht. */
  deleted: number;
  /** Jetzt (ms). */
  nowMs: number;
  /** Ende des Zeitbudgets (ms). */
  untilMs: number;
  batch?: number;
  maxRows?: number;
}): number {
  const batch = opts.batch ?? RETENTION_BATCH;
  const maxRows = opts.maxRows ?? RETENTION_MAX_ROWS;
  if (!(opts.nowMs < opts.untilMs)) return 0;
  return Math.max(0, Math.min(batch, maxRows - opts.deleted));
}

/**
 * Log-Zeile, wenn ein Schritt vor dem Ende aufhört (Obergrenze oder
 * Zeitbudget des Laufs): nur Zahlen, keine Namen.
 */
export function retentionRestLine(accountId: number, key: RetentionKey, deleted: number, remaining: number): string {
  return `[retention] account=${accountId} ${key}: ${deleted} gelöscht, ${remaining} übrig (Obergrenze bzw. Zeitbudget des Laufs) – der nächste Lauf macht weiter`;
}
