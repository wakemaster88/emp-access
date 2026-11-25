/**
 * Account-weite Löschfristen für Historien-/Log-Daten.
 * null = unbegrenzt behalten.
 */
import { prisma } from "@/lib/prisma";
import { deleteBlobs } from "@/lib/blob-store";
import { EXPIRED_TASK_ERROR } from "@/lib/hub-task-rules";
import { parseDataRetention, cutoffDate, type DataRetentionConfig, type RetentionKey } from "@/lib/data-retention-config";

export * from "@/lib/data-retention-config";

/**
 * Blob-Pfade werden vor dem Loeschen eingesammelt, hoechstens so viele pro
 * Lauf. Was uebrig bleibt, holt der Blob-GC im selben Cron nach.
 */
const BLOB_BATCH = 5000;

/**
 * Hub-Auftraege, die so lange PENDING/RUNNING sind, holt kein Hub mehr ab
 * bzw. meldet keiner mehr zurueck; sie werden auf FAILED gesetzt und fallen
 * danach unter die normale Frist fuer Hub-Auftraege.
 */
const STALE_HUB_TASK_MS = 24 * 60 * 60 * 1000;

/**
 * Geraete-Protokoll (DeviceActionLog): feste Frist in Tagen, nicht in den
 * Einstellungen waehlbar – es haelt fest, wer Tueren und Geraete geschaltet hat.
 */
export const DEVICE_ACTION_LOG_DAYS = 365;

export type RetentionPurgeResult = {
  accountId: number;
  deleted: Partial<Record<RetentionKey | "deviceActions", number>>;
};

/** Löscht abgelaufene Datensätze eines Accounts gemäß Config. */
export async function purgeAccountRetention(
  accountId: number,
  config: DataRetentionConfig,
  now = new Date()
): Promise<RetentionPurgeResult> {
  const deleted: RetentionPurgeResult["deleted"] = {};

  async function del(
    key: RetentionKey,
    run: (cutoff: Date) => Promise<number>
  ) {
    const days = config[key];
    if (days == null) return;
    const n = await run(cutoffDate(days, now));
    if (n > 0) deleted[key] = n;
  }

  await del("vehicleSightings", async (cutoff) => {
    const where = { accountId, seenAt: { lt: cutoff } };
    const blobs = await prisma.vehicleSighting.findMany({
      where: { ...where, snapshotBlob: { not: null } },
      select: { snapshotBlob: true },
      take: BLOB_BATCH,
    });
    const r = await prisma.vehicleSighting.deleteMany({ where });
    await deleteBlobs(blobs.map((b) => b.snapshotBlob));
    return r.count;
  });

  await del("personSightings", async (cutoff) => {
    const where = { accountId, seenAt: { lt: cutoff } };
    const blobs = await prisma.personSighting.findMany({
      where: { ...where, snapshotBlob: { not: null } },
      select: { snapshotBlob: true },
      take: BLOB_BATCH,
    });
    const r = await prisma.personSighting.deleteMany({ where });
    await deleteBlobs(blobs.map((b) => b.snapshotBlob));
    return r.count;
  });

  await del("cameraEvents", async (cutoff) => {
    const r = await prisma.cameraEvent.deleteMany({
      where: { accountId, startedAt: { lt: cutoff } },
    });
    return r.count;
  });

  await del("scans", async (cutoff) => {
    // Snapshots haengen per Cascade am Scan; ihre Blobs vorher einsammeln.
    const blobs = await prisma.scanSnapshot.findMany({
      where: { accountId, blobPathname: { not: null }, scan: { scanTime: { lt: cutoff } } },
      select: { blobPathname: true },
      take: BLOB_BATCH,
    });
    const r = await prisma.scan.deleteMany({
      where: { accountId, scanTime: { lt: cutoff } },
    });
    await deleteBlobs(blobs.map((b) => b.blobPathname));
    return r.count;
  });

  await del("irrigationRuns", async (cutoff) => {
    const r = await prisma.irrigationRun.deleteMany({
      where: { accountId, startedAt: { lt: cutoff } },
    });
    return r.count;
  });

  await del("automationRuns", async (cutoff) => {
    const r = await prisma.roomRuleRun.deleteMany({
      where: { accountId, triggeredAt: { lt: cutoff } },
    });
    return r.count;
  });

  await del("emailSends", async (cutoff) => {
    const r = await prisma.emailSend.deleteMany({
      where: { accountId, sentAt: { lt: cutoff } },
    });
    return r.count;
  });

  // Unabhaengig von der Frist: liegengebliebene Auftraege abschliessen.
  await prisma.hubTask.updateMany({
    where: {
      accountId,
      status: { in: ["PENDING", "RUNNING"] },
      createdAt: { lt: new Date(now.getTime() - STALE_HUB_TASK_MS) },
    },
    data: { status: "FAILED", error: EXPIRED_TASK_ERROR, finishedAt: now },
  });

  await del("hubTasks", async (cutoff) => {
    const r = await prisma.hubTask.deleteMany({
      where: {
        accountId,
        createdAt: { lt: cutoff },
        status: { in: ["DONE", "FAILED"] },
      },
    });
    return r.count;
  });

  await del("audioJobs", async (cutoff) => {
    const r = await prisma.audioJob.deleteMany({
      where: {
        accountId,
        createdAt: { lt: cutoff },
        status: { in: ["DONE", "FAILED"] },
      },
    });
    return r.count;
  });

  // Bilder haengen per Cascade an der Warnung; ihre Blobs vorher einsammeln.
  await del("monitorAlerts", async (cutoff) => {
    const where = { accountId, createdAt: { lt: cutoff } };
    const blobs = await prisma.monitorAlertImage.findMany({
      where: { blobPathname: { not: null }, alert: where },
      select: { blobPathname: true },
      take: BLOB_BATCH,
    });
    const r = await prisma.monitorAlert.deleteMany({ where });
    await deleteBlobs(blobs.map((b) => b.blobPathname));
    return r.count;
  });

  await del("discoveredDevices", async (cutoff) => {
    const r = await prisma.discoveredDevice.deleteMany({
      where: { accountId, lastSeenAt: { lt: cutoff } },
    });
    return r.count;
  });

  const actions = await prisma.deviceActionLog.deleteMany({
    where: { accountId, createdAt: { lt: cutoffDate(DEVICE_ACTION_LOG_DAYS, now) } },
  });
  if (actions.count > 0) deleted.deviceActions = actions.count;

  return { accountId, deleted };
}

/**
 * Cron: alle Accounts mit gesetzten Fristen bereinigen – auch deaktivierte,
 * damit deren Sichtungen und Bilder nicht unbegrenzt liegen bleiben.
 */
export async function purgeAllAccountsRetention(now = new Date()): Promise<{
  accounts: number;
  results: RetentionPurgeResult[];
}> {
  const accounts = await prisma.account.findMany({
    select: { id: true, dataRetention: true },
  });

  const results: RetentionPurgeResult[] = [];
  for (const a of accounts) {
    const config = parseDataRetention(a.dataRetention);
    const r = await purgeAccountRetention(a.id, config, now);
    if (Object.keys(r.deleted).length > 0) results.push(r);
  }

  return { accounts: accounts.length, results };
}

