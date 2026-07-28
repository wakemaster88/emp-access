import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import {
  shellyBaseId,
  shellyCloudAllStatuses,
  shellyLocalStatusMap,
  shellySwitchIndex,
  shellySwitchState,
  type ShellyDeviceStatusMap,
} from "@/lib/shelly-cloud";
import { coverChannels, coverMotion, isCoverDevice, type CoverMotion } from "@/lib/shelly-cover";

export interface ShellyDeviceStatus {
  id: number;
  online: boolean;
  output: boolean | null;
  power?: number;
  source: "local" | "cloud" | "unavailable";
  /// Nur bei Antrieben (MARKISE/ROLLTOR): abgeleitete Fahrtrichtung.
  motion?: CoverMotion;
}

// Geraeteliste: knappe Timeouts, damit ein nicht erreichbarer Shelly die
// gesamte Tabelle nicht ausbremst.
const LOCAL_TIMEOUT_MS = 1500;

export async function GET(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const idsParam = request.nextUrl.searchParams.get("ids") ?? "";
  const ids = idsParam.split(",").map(Number).filter((n) => !isNaN(n) && n > 0);

  if (ids.length === 0) return NextResponse.json([]);

  const devices = await db.device.findMany({
    where: { id: { in: ids }, accountId: accountId!, type: "SHELLY" },
    select: {
      id: true,
      type: true,
      category: true,
      ipAddress: true,
      shellyId: true,
      coverUpChannel: true,
      coverDownChannel: true,
      coverRuntimeSec: true,
    },
  });

  // Load saved Shelly Cloud config once
  const config = await db.apiConfig.findFirst({
    where: { accountId: accountId!, provider: "SHELLY" },
  });

  // Ein einziger Cloud-Abruf fuer alle Geraete (Shelly Cloud erlaubt nur
  // ~1 Request/s – Einzelabfragen je Geraet laufen sofort in HTTP 429).
  const cloudStatuses = config?.token && config?.baseUrl
    ? await shellyCloudAllStatuses(config.baseUrl, config.token)
    : null;

  const results = await Promise.all(devices.map(async (device): Promise<ShellyDeviceStatus> => {
    const channels = isCoverDevice(device) ? coverChannels(device) : null;

    const build = (
      status: ShellyDeviceStatusMap,
      online: boolean,
      source: "local" | "cloud",
    ): ShellyDeviceStatus => {
      if (channels) {
        const up = shellySwitchState(status, channels.up, true);
        const down = shellySwitchState(status, channels.down, true);
        return {
          id: device.id,
          online,
          output: up.output == null && down.output == null ? null : !!(up.output || down.output),
          power:
            up.power == null && down.power == null ? undefined : (up.power ?? 0) + (down.power ?? 0),
          source,
          motion: coverMotion(up.output, down.output),
        };
      }
      const sw = shellySwitchState(status, shellySwitchIndex(device.shellyId));
      return { id: device.id, online, output: sw.output, power: sw.power, source };
    };

    // 1. Local
    if (device.ipAddress) {
      const local = await shellyLocalStatusMap(device.ipAddress, LOCAL_TIMEOUT_MS);
      if (local) return build(local, true, "local");
    }

    // 2. Cloud (aus dem gemeinsamen all_status-Abruf)
    const baseId = shellyBaseId(device.shellyId);
    if (cloudStatuses && baseId) {
      const entry = cloudStatuses.get(baseId) ?? cloudStatuses.get(baseId.toLowerCase());
      if (entry) return build(entry.status, entry.online, "cloud");
    }

    return {
      id: device.id,
      online: false,
      output: null,
      source: "unavailable",
      ...(channels ? { motion: "unknown" as const } : {}),
    };
  }));

  return NextResponse.json(results);
}
