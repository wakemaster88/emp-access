/**
 * Löschfristen: Schlüssel, Beschriftungen, Defaults und reine Hilfsfunktionen.
 *
 * Bewusst ohne Prisma-Client, damit Client-Komponenten (Einstellungen) die
 * Konfiguration importieren können, ohne den Datenbanktreiber ins Browser-
 * Bundle zu ziehen. Das Löschen selbst steht in `data-retention.ts`.
 */
import type { Prisma } from "@prisma/client";

export const RETENTION_KEYS = [
  "vehicleSightings",
  "personSightings",
  "personSightingsUnknown",
  "cameraEvents",
  "scans",
  "scanSnapshots",
  "irrigationRuns",
  "automationRuns",
  "emailSends",
  "hubTasks",
  "discoveredDevices",
  "audioJobs",
  "monitorAlerts",
] as const;

export type RetentionKey = (typeof RETENTION_KEYS)[number];

/**
 * Teil-Fristen: Sie gelten für einen Teil der Daten eines anderen
 * Schlüssels und können dessen Frist nur verkürzen. null heißt hier
 * nicht „unbegrenzt“, sondern „keine eigene Frist“: Es gilt die Frist des
 * übergeordneten Schlüssels, und es läuft kein eigener Lösch-Schritt.
 *  - personSightingsUnknown: Sichtungen ohne zugeordnete Person (Teil von personSightings).
 *  - scanSnapshots: nur das Kamerafoto zum Scan, der Scan-Eintrag bleibt (Teil von scans).
 */
export const RETENTION_PARENT = {
  personSightingsUnknown: "personSightings",
  scanSnapshots: "scans",
} as const satisfies Partial<Record<RetentionKey, RetentionKey>>;

export type SubRetentionKey = keyof typeof RETENTION_PARENT;

export function isSubRetentionKey(key: RetentionKey): key is SubRetentionKey {
  return Object.prototype.hasOwnProperty.call(RETENTION_PARENT, key);
}

export type DataRetentionConfig = {
  [K in RetentionKey]: number | null;
};

/**
 * Sinnvolle Defaults (Tage) – DSGVO-orientiert, Historie bleibt nutzbar.
 * Die Teil-Fristen stehen auf null (keine eigene Frist): Ein Konto ohne
 * gespeicherten Wert löscht damit genau das, was die übergeordnete Frist
 * löscht. Ein Wert wird nur von Hand in den Einstellungen gesetzt.
 */
export const DEFAULT_DATA_RETENTION: DataRetentionConfig = {
  vehicleSightings: 30,
  personSightings: 30,
  personSightingsUnknown: null,
  cameraEvents: 14,
  scans: 365,
  scanSnapshots: null,
  irrigationRuns: 365,
  automationRuns: 90,
  emailSends: 180,
  hubTasks: 14,
  discoveredDevices: 60,
  audioJobs: 30,
  monitorAlerts: 30,
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
  personSightingsUnknown: {
    label: "Unbekannte Personen",
    description:
      "Löscht Sichtungen ohne zugeordnete Person samt Bild und Gesichtsmerkmal; zugeordnete und gesperrte Personen behalten die Frist „Personen“. Wirkt nur, wenn kürzer als „Personen“.",
  },
  cameraEvents: {
    label: "Kamera-Ereignisse",
    description: "MOTION/PERSON/VEHICLE-Events vom Hub",
  },
  scans: {
    label: "Scans",
    description: "Zutrittsscan-Protokoll",
  },
  scanSnapshots: {
    label: "Scan-Fotos",
    description: "Löscht nur das Kamerafoto zum Scan; der Scan-Eintrag bleibt bis zur Frist „Scans“. Wirkt nur, wenn kürzer als „Scans“.",
  },
  irrigationRuns: {
    label: "Bewässerung",
    description: "Bewässerungs-Läufe",
  },
  automationRuns: {
    label: "Regeln",
    description: "Verlauf der Raumregeln",
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
  monitorAlerts: {
    label: "Monitor-Warnungen",
    description: "Warnungen am Kassen-Monitor inkl. Schnappschüssen",
  },
};

export const RETENTION_DAY_OPTIONS = [
  { value: null as number | null, label: "Unbegrenzt" },
  { value: 7, label: "7 Tage" },
  { value: 14, label: "14 Tage" },
  { value: 30, label: "30 Tage" },
  // Standard der Netzwerk-Discovery (discoveredDevices); ohne diese Option bliebe ihre Auswahl leer.
  { value: 60, label: "60 Tage" },
  { value: 90, label: "90 Tage" },
  { value: 180, label: "180 Tage" },
  { value: 365, label: "365 Tage" },
] as const;

/**
 * Beschriftung der Auswahl „null“: bei Teil-Fristen „Wie …“ (Frist des
 * übergeordneten Schlüssels), sonst „Unbegrenzt“.
 */
export function retentionNullLabel(key: RetentionKey): string {
  return isSubRetentionKey(key) ? `Wie „${RETENTION_LABELS[RETENTION_PARENT[key]].label}“` : "Unbegrenzt";
}

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
export function retentionToJson(config: DataRetentionConfig): Prisma.InputJsonValue {
  return { ...config };
}
