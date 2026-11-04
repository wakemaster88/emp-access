/**
 * Bewegungsmelder als Anwesenheit im Raum.
 *
 * In Umkleiden und WCs sind keine Kameras erlaubt. Ein Shelly-Bewegungsmelder
 * im Raum liefert dort die Anwesenheit: der 5-Minuten-Takt liest den Status aus
 * der Shelly Cloud und legt je erkannter Bewegung ein `RoomMotionEvent` an.
 * Das Ereignis-Widget zaehlt sie wie Personen-Ereignisse einer Kamera.
 *
 * Erkannt werden:
 *  - Gen2/BLU: Komponente `motion:N` mit `{ motion: boolean, ts? }`
 *  - Gen1 (Shelly Motion): `sensor: { motion: boolean, timestamp }`
 *
 * Meldet der Melder einen Zeitstempel der letzten Bewegung, zaehlt jede
 * Bewegung einmal (eindeutig je Geraet und Zeitpunkt). Ohne Zeitstempel zaehlt
 * jede Abfrage mit "Bewegung erkannt" als ein Ereignis.
 */

import { prisma } from "@/lib/prisma";
import { shellyBaseId, shellyCloudAllStatuses } from "@/lib/shelly-cloud";
import { readMotion, type MotionReading } from "@/lib/shelly-sensor";

export { readMotion };

/** Bewegungen, die laenger her sind, legt der Takt nicht mehr nach. */
export const MOTION_LOOKBACK_MS = 10 * 60_000;
/** So lange nach der letzten Bewegung gilt der Raum als besetzt. */

/** Aufbewahrung der Bewegungs-Ereignisse. */
export const MOTION_RETENTION_DAYS = 30;

/**
 * Zeitpunkt, der als Ereignis gespeichert wird, oder null. Der Melder-
 * Zeitstempel hat Vorrang; ohne ihn zaehlt "Bewegung jetzt" zur vollen Minute.
 */
export function motionEventAt(reading: MotionReading, now: Date): Date | null {
  if (reading.lastMotionAt) {
    const age = now.getTime() - reading.lastMotionAt.getTime();
    return age >= -60_000 && age <= MOTION_LOOKBACK_MS ? reading.lastMotionAt : null;
  }
  if (!reading.motion) return null;
  return new Date(Math.floor(now.getTime() / 60_000) * 60_000);
}

export interface MotionTickResult {
  sensors: number;
  events: number;
}

export async function runMotionTick(now = new Date()): Promise<MotionTickResult> {
  const result: MotionTickResult = { sensors: 0, events: 0 };
  const configs = await prisma.apiConfig.findMany({
    where: { provider: "SHELLY", baseUrl: { not: null } },
    select: { accountId: true, token: true, baseUrl: true },
  });

  for (const config of configs) {
    if (!config.token || !config.baseUrl) continue;
    const devices = await prisma.device.findMany({
      where: { accountId: config.accountId, type: "SHELLY", isActive: true, keyRoomId: { not: null } },
      select: { id: true, shellyId: true, keyRoomId: true },
    });
    if (devices.length === 0) continue;
    const statuses = await shellyCloudAllStatuses(config.baseUrl, config.token);
    if (!statuses) continue;

    const rows: { accountId: number; roomId: number; deviceId: number; at: Date }[] = [];
    const seenBase = new Set<string>();
    for (const d of devices) {
      const baseId = shellyBaseId(d.shellyId);
      // Mehrkanal-Geraete nur einmal auswerten.
      if (!baseId || seenBase.has(baseId)) continue;
      seenBase.add(baseId);
      const entry = statuses.get(baseId) ?? statuses.get(baseId.toLowerCase());
      if (!entry) continue;
      const reading = readMotion(entry.status);
      if (!reading) continue;
      result.sensors++;
      const at = motionEventAt(reading, now);
      if (at) rows.push({ accountId: config.accountId, roomId: d.keyRoomId!, deviceId: d.id, at });
    }
    if (rows.length) {
      const created = await prisma.roomMotionEvent.createMany({ data: rows, skipDuplicates: true });
      result.events += created.count;
    }
  }

  await prisma.roomMotionEvent.deleteMany({
    where: { at: { lt: new Date(now.getTime() - MOTION_RETENTION_DAYS * 86_400_000) } },
  });
  return result;
}
