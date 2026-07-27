/**
 * Account-weite Löschfristen für Historien-/Log-Daten.
 * null = unbegrenzt behalten.
 */
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export const RETENTION_KEYS = [
  "vehicleSightings",
  "personSightings",
  "cameraEvents",
  "scans",
  "irrigationRuns",
  "automationRuns",
  "emailSends",
  "hubTasks",
  "discoveredDevices",
  "audioJobs",
] as const;

export type RetentionKey = (typeof RETENTION_KEYS)[number];

export type DataRetentionConfig = {
  [K in RetentionKey]: number | null;
};

/** Sinnvolle Defaults (Tage) – DSGVO-orientiert, Historie bleibt nutzbar. */
export const DEFAULT_DATA_RETENTION: DataRetentionConfig = {
  vehicleSightings: 30,
  personSightings: 30,
  cameraEvents: 14,
  scans: 365,
  irrigationRuns: 365,
  automationRuns: 90,
  emailSends: 180,
  hubTasks: 14,
  discoveredDevices: 60,
  audioJobs: 30,
};

export const RETENTION_LABELS: Record<
  RetentionKey,
  { label: string; description: string }
> = {
  vehicleSightings: {
    label: "Fahrzeuge",
    description: "Fahrzeug-Historie inkl. Schnappschüsse",
  },
  personSightings: {
    label: "Personen",
    description: "Personen-Historie inkl. Face-Snaps",
  },
  cameraEvents: {
    label: "Kamera-Ereignisse",
    description: "MOTION/PERSON/VEHICLE-Events vom Hub",
  },
  scans: {
    label: "Scans",
    description: "Zutrittsscan-Protokoll",
  },
  irrigationRuns: {
    label: "Bewässerung",
    description: "Bewässerungs-Läufe",
  },
  automationRuns: {
    label: "Automation",
    description: "Shelly-/Kamera-Automations-Protokoll",
  },
  emailSends: {
    label: "E-Mail",
    description: "E-Mail-Versandprotokoll",
  },
  hubTasks: {
    label: "Hub-Tasks",
    description: "Erledigte/fehlgeschlagene Hub-Aufgaben",
  },
  discoveredDevices: {
    label: "Netzwerk-Discovery",
    description: "Geräte, die länger nicht mehr gesehen wurden",
  },
  audioJobs: {
    label: "Audio",
    description: "Protokoll abgespielter Durchsagen und Steuerbefehle",
  },
};

export const RETENTION_DAY_OPTIONS = [
  { value: null as number | null, label: "Unbegrenzt" },
  { value: 7, label: "7 Tage" },
  { value: 14, label: "14 Tage" },
  { value: 30, label: "30 Tage" },
  { value: 90, label: "90 Tage" },
  { value: 180, label: "180 Tage" },
  { value: 365, label: "365 Tage" },
] as const;

function isRetentionDays(v: unknown): v is number | null {
  if (v === null) return true;
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 3650;
}

/** Roh-JSON aus DB mit Defaults mergen. */
export function parseDataRetention(raw: unknown): DataRetentionConfig {
  const out: DataRetentionConfig = { ...DEFAULT_DATA_RETENTION };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const obj = raw as Record<string, unknown>;
  for (const key of RETENTION_KEYS) {
    if (key in obj && isRetentionDays(obj[key])) {
      out[key] = obj[key] as number | null;
    }
  }
  return out;
}

export function cutoffDate(days: number, now = new Date()): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export type RetentionPurgeResult = {
  accountId: number;
  deleted: Partial<Record<RetentionKey, number>>;
};

/** Löscht abgelaufene Datensätze eines Accounts gemäß Config. */
export async function purgeAccountRetention(
  accountId: number,
  config: DataRetentionConfig,
  now = new Date()
): Promise<RetentionPurgeResult> {
  const deleted: Partial<Record<RetentionKey, number>> = {};

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
    const r = await prisma.vehicleSighting.deleteMany({
      where: { accountId, seenAt: { lt: cutoff } },
    });
    return r.count;
  });

  await del("personSightings", async (cutoff) => {
    const r = await prisma.personSighting.deleteMany({
      where: { accountId, seenAt: { lt: cutoff } },
    });
    return r.count;
  });

  await del("cameraEvents", async (cutoff) => {
    const r = await prisma.cameraEvent.deleteMany({
      where: { accountId, startedAt: { lt: cutoff } },
    });
    return r.count;
  });

  await del("scans", async (cutoff) => {
    const r = await prisma.scan.deleteMany({
      where: { accountId, scanTime: { lt: cutoff } },
    });
    return r.count;
  });

  await del("irrigationRuns", async (cutoff) => {
    const r = await prisma.irrigationRun.deleteMany({
      where: { accountId, startedAt: { lt: cutoff } },
    });
    return r.count;
  });

  await del("automationRuns", async (cutoff) => {
    const r = await prisma.shellyAutomationRun.deleteMany({
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

  await del("discoveredDevices", async (cutoff) => {
    const r = await prisma.discoveredDevice.deleteMany({
      where: { accountId, lastSeenAt: { lt: cutoff } },
    });
    return r.count;
  });

  return { accountId, deleted };
}

/** Cron: alle Accounts mit gesetzten Fristen bereinigen. */
export async function purgeAllAccountsRetention(now = new Date()): Promise<{
  accounts: number;
  results: RetentionPurgeResult[];
}> {
  const accounts = await prisma.account.findMany({
    where: { isActive: true },
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

export function retentionToJson(config: DataRetentionConfig): Prisma.InputJsonValue {
  return { ...config };
}
