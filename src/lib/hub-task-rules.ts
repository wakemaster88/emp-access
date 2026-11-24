/**
 * Reine Regeln fuer Hub-Auftraege und den Einmal-Oeffnen-Task der Pis
 * (ohne Datenbank, damit testbar).
 */
import { z } from "zod";

/** Nach dieser Zeit wird ein augenblicksgebundener Schaltbefehl nicht mehr ausgeliefert. */
export const SWITCH_COMMAND_MAX_AGE_MS = 60_000;

/** Fehlertext fuer verfallene Auftraege. */
export const EXPIRED_TASK_ERROR = "abgelaufen";

/**
 * Hub-Auftraege, die nur im Moment der Ausloesung Sinn ergeben: Tuer einmal
 * oeffnen, Kamera schwenken, Kamera-Szene, Regler, Bild zum Scan. Bleiben sie
 * laenger als SWITCH_COMMAND_MAX_AGE_MS liegen (Hub offline), setzt die
 * Abholung sie auf FAILED statt sie auszuliefern.
 *
 * Bewusst NICHT dabei: Zustaende mit eigenem Ende (DOORBIRD_HOLD mit
 * payload.until), Abfragen und lange Laeufe (Netzwerk-Scan, Sync, Gesichter,
 * Log, Neustart, Systempflege, Presets/Faehigkeiten lesen, Shelly-Status),
 * Einstellungen (CAMERA_IR), Maeher, Wake-on-LAN, Schnappschuss auf Anfrage
 * und MCP-Werkzeuge (eigene Frist im Payload).
 */
export const ALWAYS_EXPIRING_HUB_TASK_TYPES = [
  "DOORBIRD_OPEN",
  "CAMERA_PTZ",
  "CAMERA_SCENE",
  "SOUNDWEB_SET",
  "SCAN_SNAPSHOT",
] as const;

/**
 * Licht, Relais, Sirene: nur Einschalt-Befehle verfallen. Ausschalten (und
 * Umschalten ohne `on` bei Shelly) bringt das Geraet in den Ruhezustand
 * zurueck und wird wie bisher auch spaet noch ausgeliefert.
 */
export const ON_ONLY_EXPIRING_HUB_TASK_TYPES = [
  "HUE_SET",
  "CAMERA_SPOTLIGHT",
  "CAMERA_SIREN",
] as const;

/** Shelly liest `on` auch als Text ("true"/"on"), siehe hub/src/tasks.ts. */
export const SHELLY_SWITCH_TYPE = "SHELLY_SWITCH";
const SHELLY_ON_VALUES = [true, "true", "on"] as const;

/** Alle Typen, die (zumindest beim Einschalten) verfallen koennen. */
export const EXPIRING_HUB_TASK_TYPES = [
  ...ALWAYS_EXPIRING_HUB_TASK_TYPES,
  ...ON_ONLY_EXPIRING_HUB_TASK_TYPES,
  SHELLY_SWITCH_TYPE,
] as const;

/**
 * Filter fuer das updateMany der Abholung: offene Schaltbefehle des
 * Mandanten, die aelter als SWITCH_COMMAND_MAX_AGE_MS sind und verfallen.
 */
export function expiredSwitchCommandsWhere(accountId: number, now: Date = new Date()) {
  return {
    accountId,
    status: "PENDING",
    createdAt: { lt: switchCommandCutoff(now) },
    OR: [
      { type: { in: [...ALWAYS_EXPIRING_HUB_TASK_TYPES] } },
      { type: { in: [...ON_ONLY_EXPIRING_HUB_TASK_TYPES] }, payload: { path: ["on"], equals: true } },
      ...SHELLY_ON_VALUES.map((value) => ({
        type: SHELLY_SWITCH_TYPE,
        payload: { path: ["on"], equals: value },
      })),
    ],
  };
}

/** Bild zum Scan-Zeitpunkt: wird nach den Steuerbefehlen ausgeliefert. */
export const SCAN_SNAPSHOT_TYPE = "SCAN_SNAPSHOT";

/** Ab diesem Zeitpunkt (exklusiv) gilt ein offener Schaltbefehl als verfallen. */
export function switchCommandCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - SWITCH_COMMAND_MAX_AGE_MS);
}

/**
 * Einmal-Oeffnen am Pi (Device.task = 1): verfallen, wenn der Zeitpunkt des
 * Setzens bekannt und aelter als SWITCH_COMMAND_MAX_AGE_MS ist. Ohne
 * Zeitpunkt (alte Zeilen) bleibt alles wie bisher. Andere Werte (NOT-AUF,
 * deaktiviert) sind Zustaende und verfallen nie.
 */
export function piOpenTaskExpired(
  task: number,
  taskSetAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (task !== 1 || !taskSetAt) return false;
  return now.getTime() - taskSetAt.getTime() > SWITCH_COMMAND_MAX_AGE_MS;
}

/** Zeitpunkt, der zusammen mit Device.task gespeichert wird (null bei 0). */
export function deviceTaskSetAt(task: number, now: Date = new Date()): Date | null {
  return task === 0 ? null : now;
}

// Typ-Alias statt interface: so passt er in Prisma-JSON-Felder.
/** Wer einen Auftrag von Hand ausgeloest hat (steht in HubTask.payload.by). */
export type HubTaskActor = {
  adminId: number | null;
  name: string | null;
};

export function hubTaskActor(user: { id?: string | null; name?: string | null } | null | undefined): HubTaskActor {
  const adminId = Number(user?.id);
  return {
    adminId: Number.isInteger(adminId) && adminId > 0 ? adminId : null,
    name: user?.name ? String(user.name).slice(0, 120) : null,
  };
}

/** Kamera-gebundene Auftraege: payload.cameraId muss eine Kamera des Mandanten sein. */
export const CAMERA_HUB_TASK_TYPES = new Set([
  "CAMERA_SNAPSHOT",
  "DOORBIRD_OPEN",
  "DOORBIRD_HOLD",
  "CAMERA_PTZ",
  "CAMERA_SPOTLIGHT",
  "CAMERA_IR",
  "CAMERA_SIREN",
  "CAMERA_PTZ_PRESETS",
  "CAMERA_SCENE",
]);

const cameraId = z.coerce.number().int().positive();

/**
 * Payload-Pruefung je Typ fuer POST /api/hub/tasks, gebaut aus dem, was die
 * Oberflaeche heute schickt (Kamera-Ansicht, Hub-Karte unter Netzwerk).
 * Zusaetzliche Felder bleiben erlaubt. Typen ohne Eintrag werden wie bisher
 * nur ueber VALID_TASK_TYPES geprueft (ausser cameraId bei Kamera-Typen).
 */
const PAYLOAD_SCHEMAS: Record<string, z.ZodType> = {
  // Kamera-Ansicht: { cameraId }; MCP nutzt zusaetzlich maxPx (eigener Weg).
  CAMERA_SNAPSHOT: z.looseObject({ cameraId, maxPx: z.number().optional() }),
  // Kamera-Ansicht: { cameraId }; Relais optional wie bei Telegram/Vereinsportal.
  DOORBIRD_OPEN: z.looseObject({ cameraId, relay: z.number().int().positive().optional() }),
  // Hub-Karte: Neustart von Tracker oder Hub.
  SERVICE_RESTART: z.looseObject({ service: z.enum(["tracker", "hub"]) }),
  // Hub-Karte „Log abrufen“: Datei, Zeilen, Filter und Position.
  HUB_LOG: z.looseObject({
    file: z.enum(["hub", "error", "improve"]).optional(),
    lines: z.number().int().positive().optional(),
    grep: z.string().max(1000).optional(),
    at: z.string().max(100).optional(),
    before: z.number().optional(),
    after: z.number().optional(),
  }),
};

const anyCameraPayload = z.looseObject({ cameraId });

export type HubTaskPayloadCheck =
  | { ok: true; payload: unknown; cameraId: number | null }
  | { ok: false; error: string };

/**
 * Prueft das Payload eines neuen Hub-Auftrags. Gibt das Payload unveraendert
 * zurueck (kein Umschreiben der Felder) und die cameraId, die gegen den
 * Mandanten geprueft werden muss.
 */
export function checkHubTaskPayload(type: string, payload: unknown): HubTaskPayloadCheck {
  const schema = PAYLOAD_SCHEMAS[type] ?? (CAMERA_HUB_TASK_TYPES.has(type) ? anyCameraPayload : null);
  if (!schema) return { ok: true, payload, cameraId: null };
  const parsed = schema.safeParse(payload ?? {});
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path.join(".") || "payload";
    return { ok: false, error: `Ungültige Auftragsdaten (${field})` };
  }
  const id = CAMERA_HUB_TASK_TYPES.has(type) ? Number((parsed.data as { cameraId: unknown }).cameraId) : null;
  return { ok: true, payload, cameraId: id };
}

/**
 * Haengt `by` an ein Payload. Nur bei fehlendem oder Objekt-Payload – andere
 * Formen bleiben unveraendert.
 */
export function withActor(payload: unknown, by: HubTaskActor): unknown {
  if (payload == null) return { by };
  if (typeof payload === "object" && !Array.isArray(payload)) return { ...(payload as object), by };
  return payload;
}
