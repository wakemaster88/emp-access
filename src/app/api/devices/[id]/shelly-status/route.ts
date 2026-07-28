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

export interface ShellyCoverStatus {
  /// Abgeleitete Fahrtrichtung aus beiden Relaiszustaenden.
  motion: CoverMotion;
  upOn: boolean | null;
  downOn: boolean | null;
  /// false = Kanalzuordnung fehlt oder ist unbrauchbar (z. B. Auf = Zu).
  configured: boolean;
}

export interface ShellyStatus {
  online: boolean;
  output: boolean | null;   // true = on, false = off, null = unknown
  power?: number;           // current power in W
  source: "local" | "cloud" | "unavailable";
  /// Nur bei Antrieben (MARKISE/ROLLTOR) gesetzt.
  cover?: ShellyCoverStatus;
}

const UNAVAILABLE: ShellyStatus = { online: false, output: null, source: "unavailable" };

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { id } = await params;
  const deviceId = Number(id);
  if (isNaN(deviceId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const { db, accountId } = session;

  const device = await db.device.findFirst({
    where: { id: deviceId, accountId: accountId!, type: "SHELLY" },
  });

  if (!device) return NextResponse.json({ error: "Gerät nicht gefunden" }, { status: 404 });

  const isCover = isCoverDevice(device);
  const channels = isCover ? coverChannels(device) : null;

  if (isCover && !channels) {
    // Kategorie ist gesetzt, die Kanalzuordnung fehlt aber noch.
    return NextResponse.json({
      ...UNAVAILABLE,
      cover: { motion: "unknown", upOn: null, downOn: null, configured: false },
    } satisfies ShellyStatus);
  }

  const build = (
    status: ShellyDeviceStatusMap,
    online: boolean,
    source: "local" | "cloud",
  ): ShellyStatus => {
    if (channels) {
      const up = shellySwitchState(status, channels.up, true);
      const down = shellySwitchState(status, channels.down, true);
      const power = (up.power ?? 0) + (down.power ?? 0);
      return {
        online,
        // Ein Antrieb gilt als "aktiv", solange eine Fahrtrichtung anliegt.
        output: up.output == null && down.output == null ? null : !!(up.output || down.output),
        power: up.power == null && down.power == null ? undefined : power,
        source,
        cover: {
          motion: coverMotion(up.output, down.output),
          upOn: up.output,
          downOn: down.output,
          configured: true,
        },
      };
    }

    const sw = shellySwitchState(status, shellySwitchIndex(device.shellyId));
    return { online, output: sw.output, power: sw.power, source };
  };

  // 1. Lokale IP (Gen2 Shelly.GetStatus, sonst Gen1 /status)
  if (device.ipAddress) {
    const local = await shellyLocalStatusMap(device.ipAddress);
    if (local) return NextResponse.json(build(local, true, "local"));
  }

  // 2. Shelly Cloud – gemeinsamer, gecachter all_status-Abruf statt einzelner
  //    /device/status-Calls (die laufen bei mehreren Geraeten in HTTP 429).
  const baseId = shellyBaseId(device.shellyId);
  const config = await db.apiConfig.findFirst({
    where: { accountId: accountId!, provider: "SHELLY" },
  });

  if (config?.token && config?.baseUrl && baseId) {
    const cloudStatuses = await shellyCloudAllStatuses(config.baseUrl, config.token);
    const entry = cloudStatuses?.get(baseId) ?? cloudStatuses?.get(baseId.toLowerCase());
    if (entry) return NextResponse.json(build(entry.status, entry.online, "cloud"));
  }

  return NextResponse.json(
    channels
      ? { ...UNAVAILABLE, cover: { motion: "unknown", upOn: null, downOn: null, configured: true } }
      : UNAVAILABLE,
  );
}
