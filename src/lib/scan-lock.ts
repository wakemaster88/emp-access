import type { PrismaClient } from "@prisma/client";

export const MAX_SCAN_LOCK_SECONDS = 3600;
const BOUNCE_MS = 5_000;

export function parseScanLockSeconds(raw: unknown, current: number | null): number | null {
  if (raw === undefined) return current;
  if (raw === null || raw === "" || raw === 0 || raw === "0") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return current;
  const rounded = Math.round(n);
  if (rounded === 0) return null;
  return Math.min(MAX_SCAN_LOCK_SECONDS, rounded);
}

export function scanLockMessage(remainingMs: number): string {
  const secs = Math.max(1, Math.ceil(remainingMs / 1000));
  if (secs >= 60) {
    const minutes = Math.ceil(secs / 60);
    return minutes === 1
      ? "Dieses Ticket erst in 1 Minute wieder scannen"
      : `Dieses Ticket erst in ${minutes} Minuten wieder scannen`;
  }
  return secs === 1
    ? "Dieses Ticket erst in 1 Sekunde wieder scannen"
    : `Dieses Ticket erst in ${secs} Sekunden wieder scannen`;
}

export type ScanLockDenial = {
  message: string;
  remainingMs: number;
  /** Gleicher Code direkt nach dem GRANTED – kein extra DENIED-Datensatz. */
  silent: boolean;
};

/**
 * Sperrt denselben Ticket-Scan am Geraet, solange die konfigurierte Zeit
 * seit dem letzten GRANTED dieses Tickets noch laeuft. Andere Tickets
 * bleiben frei. Ohne ticketId gilt die Sperre nur fuer denselben Code.
 */
export async function evaluateScanLock(
  db: PrismaClient,
  opts: {
    accountId: number;
    deviceId: number | null | undefined;
    lockSeconds: number | null | undefined;
    code: string;
    ticketId?: number | null;
    isExit?: boolean;
  },
): Promise<ScanLockDenial | null> {
  const lockSeconds = opts.lockSeconds ?? 0;
  if (!opts.deviceId || lockSeconds <= 0 || opts.isExit) return null;

  const last = await db.scan.findFirst({
    where: {
      deviceId: opts.deviceId,
      accountId: opts.accountId,
      result: "GRANTED",
      ...(opts.ticketId != null ? { ticketId: opts.ticketId } : { code: opts.code }),
    },
    orderBy: { scanTime: "desc" },
    select: { scanTime: true, code: true },
  });
  if (!last) return null;

  const remainingMs = last.scanTime.getTime() + lockSeconds * 1000 - Date.now();
  if (remainingMs <= 0) return null;

  const ageMs = Date.now() - last.scanTime.getTime();
  const silent = last.code === opts.code && ageMs < BOUNCE_MS;

  return {
    remainingMs,
    silent,
    message: scanLockMessage(remainingMs),
  };
}
