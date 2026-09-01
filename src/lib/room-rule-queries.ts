/**
 * Gemeinsame Abfragen und Schreibhilfen fuer Raumregeln.
 *
 * Die Regel-Engine in `room-rules.ts` laedt eigene, schlankere Ausschnitte.
 * Was hier steht, ist fuer die Oberflaeche gedacht: Namen statt IDs, damit
 * eine Regel ohne Nachschlagen lesbar ist.
 */

import type { TenantDb } from "@/lib/prisma";
import type { roomRuleActionSchema } from "@/lib/validators";
import type { z } from "zod";

export type ActionInput = z.infer<typeof roomRuleActionSchema>;

export const ruleInclude = {
  room: { select: { id: true, name: true } },
  camera: { select: { id: true, name: true } },
  triggerDevice: { select: { id: true, name: true } },
  area: { select: { id: true, name: true } },
  operatingSchedule: { select: { id: true, name: true } },
  actions: {
    orderBy: { sortOrder: "asc" as const },
    include: {
      device: { select: { id: true, name: true, type: true } },
      audioZone: { select: { id: true, name: true } },
      audioAnnouncement: { select: { id: true, name: true } },
      audioPlaylist: { select: { id: true, name: true } },
    },
  },
};

/**
 * Ersetzt die Aktionen einer Regel vollstaendig.
 *
 * Loeschen und neu anlegen statt abgleichen: Aktionen tragen keinen Zustand,
 * den man erhalten muesste, und die Reihenfolge ist Teil der Bedeutung.
 * Felder, die nicht zur Art passen, werden bewusst auf `null` gesetzt – sonst
 * bliebe beim Wechsel von Audio auf Gerät die alte Zone als Leiche stehen.
 */
export async function replaceRuleActions(
  db: TenantDb,
  ruleId: number,
  actions: ActionInput[],
): Promise<void> {
  await db.roomRuleAction.deleteMany({ where: { ruleId } });
  if (actions.length === 0) return;

  await db.roomRuleAction.createMany({
    data: actions.map((action, index) => ({
      ruleId,
      sortOrder: action.sortOrder ?? index,
      kind: action.kind,
      deviceId: action.kind === "DEVICE" ? (action.deviceId ?? null) : null,
      deviceAction: action.kind === "DEVICE" ? (action.deviceAction ?? null) : null,
      timerSeconds: action.kind === "DEVICE" ? (action.timerSeconds ?? null) : null,
      channel: action.kind === "NOTIFY" ? (action.channel ?? "PUSH") : null,
      message: action.kind === "NOTIFY" ? (action.message?.trim() || null) : null,
      audioZoneId: action.kind === "AUDIO" ? (action.audioZoneId ?? null) : null,
      audioAnnouncementId: action.kind === "AUDIO" ? (action.audioAnnouncementId ?? null) : null,
      audioPlaylistId: action.kind === "AUDIO" ? (action.audioPlaylistId ?? null) : null,
    })),
  });
}

/**
 * Prueft, dass alle in der Regel genannten Fremdschluessel zum Mandanten
 * gehoeren. Gibt die erste Beanstandung als Text zurueck, sonst `null`.
 *
 * Row-Level Security verhindert bereits das Lesen fremder Zeilen, aber ein
 * Verweis auf eine nicht existierende ID wuerde sonst erst als
 * Fremdschluesselfehler der Datenbank auffallen – mit unlesbarer Meldung.
 */
export async function validateRuleReferences(
  db: TenantDb,
  accountId: number,
  input: {
    roomId?: number | null;
    cameraId?: number | null;
    triggerDeviceId?: number | null;
    areaId?: number | null;
    operatingScheduleId?: number | null;
    actions?: ActionInput[];
  },
): Promise<string | null> {
  const checks: Array<[string, Promise<unknown>]> = [];

  if (input.roomId) {
    checks.push([
      "Raum nicht gefunden",
      db.keyRoom.findFirst({ where: { id: input.roomId, accountId }, select: { id: true } }),
    ]);
  }
  if (input.cameraId) {
    checks.push([
      "Kamera nicht gefunden",
      db.camera.findFirst({ where: { id: input.cameraId, accountId }, select: { id: true } }),
    ]);
  }
  if (input.triggerDeviceId) {
    checks.push([
      "Auslösendes Gerät nicht gefunden",
      db.device.findFirst({
        where: { id: input.triggerDeviceId, accountId },
        select: { id: true },
      }),
    ]);
  }
  if (input.areaId) {
    checks.push([
      "Zutrittsbereich nicht gefunden",
      db.accessArea.findFirst({ where: { id: input.areaId, accountId }, select: { id: true } }),
    ]);
  }
  if (input.operatingScheduleId) {
    checks.push([
      "Betriebszeit nicht gefunden",
      db.operatingSchedule.findFirst({
        where: { id: input.operatingScheduleId, accountId },
        select: { id: true },
      }),
    ]);
  }

  const deviceIds = [
    ...new Set(
      (input.actions ?? [])
        .filter((a) => a.kind === "DEVICE" && a.deviceId)
        .map((a) => a.deviceId as number),
    ),
  ];
  const zoneIds = [
    ...new Set(
      (input.actions ?? [])
        .filter((a) => a.kind === "AUDIO" && a.audioZoneId)
        .map((a) => a.audioZoneId as number),
    ),
  ];

  const [results, devices, zones] = await Promise.all([
    Promise.all(checks.map(([, promise]) => promise)),
    deviceIds.length > 0
      ? db.device.findMany({ where: { id: { in: deviceIds }, accountId }, select: { id: true } })
      : Promise.resolve([]),
    zoneIds.length > 0
      ? db.audioZone.findMany({ where: { id: { in: zoneIds }, accountId }, select: { id: true } })
      : Promise.resolve([]),
  ]);

  for (const [index, result] of results.entries()) {
    if (!result) return checks[index][0];
  }
  if (devices.length !== deviceIds.length) return "Zielgerät nicht gefunden";
  if (zones.length !== zoneIds.length) return "Audio-Zone nicht gefunden";

  return null;
}
