import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";
import { isOperatingAt } from "@/lib/operating-hours";
import { scheduleSpecInclude, toScheduleSpec } from "@/lib/operating-queries";
import { DEFAULT_TIMEZONE } from "@/lib/tz-time";
import { climateView } from "@/lib/room-climate";

/**
 * GET (Hub, Token-Auth): Raeume mit Geraeten, Kameras, Audiozonen und Regeln
 * fuer die Raum-Steuerung im Hub-Dashboard.
 *
 * Die Cloud bleibt die einzige Stelle, an der Raeume und Regeln gepflegt
 * werden; der Hub spiegelt diesen Stand, haelt ihn auf der Platte vor und
 * schaltet Shellys damit direkt im LAN. Zugangsdaten (Shelly-Cloud-Keys,
 * Geraete-Token) gehen bewusst nicht mit.
 */
export async function GET(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const { db, account } = auth;

  const deviceSelect = {
    id: true,
    name: true,
    type: true,
    category: true,
    ipAddress: true,
    shellyId: true,
    coverUpChannel: true,
    coverDownChannel: true,
    coverRuntimeSec: true,
    pulseSeconds: true,
    isActive: true,
    task: true,
    lastUpdate: true,
    keyRoomId: true,
    hueBridgeId: true,
    hueLightId: true,
    mowerName: true,
  } as const;

  const [rooms, unassigned, acc, schedules, irrigation] = await Promise.all([
    db.keyRoom.findMany({
      where: { accountId: account.id },
      orderBy: [{ building: "asc" }, { floor: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        number: true,
        building: true,
        floor: true,
        devices: { where: { isActive: true }, select: deviceSelect, orderBy: { name: "asc" } },
        cameras: { select: { id: true, name: true, kind: true }, orderBy: { name: "asc" } },
        audioZones: {
          where: { isActive: true },
          select: { id: true, name: true },
          orderBy: { sortOrder: "asc" },
        },
        operatingSchedule: { select: { id: true, name: true, ...scheduleSpecInclude } },
        climate: true,
        rules: {
          select: { id: true, name: true, trigger: true, isActive: true, lastRunAt: true },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        },
      },
    }),
    db.device.findMany({
      where: { accountId: account.id, isActive: true, keyRoomId: null },
      select: deviceSelect,
      orderBy: { name: "asc" },
    }),
    db.account.findUnique({ where: { id: account.id }, select: { timezone: true, latitude: true, longitude: true } }),
    db.operatingSchedule.findMany({
      where: { accountId: account.id },
      select: { id: true, name: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    // Fuer die Wetter-Vorschau des Hub-Assistenten (nur lesen, keine Steuerung).
    db.irrigationSchedule.findMany({
      where: { accountId: account.id },
      select: {
        id: true,
        startTime: true,
        daysOfWeek: true,
        durationMinutes: true,
        isActive: true,
        skipOnRain: true,
        smartRain: true,
        sensorServiceId: true,
        lastRunAt: true,
        device: { select: { name: true } },
      },
      orderBy: { startTime: "asc" },
    }),
  ]);

  const tz = acc?.timezone || DEFAULT_TIMEZONE;
  const now = new Date();

  return NextResponse.json({
    at: now.toISOString(),
    timezone: tz,
    location:
      acc?.latitude != null && acc?.longitude != null ? { latitude: acc.latitude, longitude: acc.longitude } : null,
    schedules,
    irrigation: irrigation.map(({ device, sensorServiceId, lastRunAt, ...s }) => ({
      ...s,
      name: device.name,
      moistureSensor: !!sensorServiceId,
      lastRunAt: lastRunAt?.toISOString() ?? null,
    })),
    rooms: rooms.map(({ operatingSchedule, climate, ...room }) => ({
      ...room,
      climate: climate ? climateView(climate) : null,
      operating: operatingSchedule
        ? {
            id: operatingSchedule.id,
            name: operatingSchedule.name,
            open: isOperatingAt(toScheduleSpec(operatingSchedule), now, tz),
          }
        : null,
    })),
    unassigned,
  });
}
