import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import {
  shellyBaseId,
  shellyCloudAllStatuses,
  shellySwitchIndex,
  shellySwitchState,
} from "@/lib/shelly-cloud";

export interface ShellyStatus {
  online: boolean;
  output: boolean | null;   // true = on, false = off, null = unknown
  power?: number;           // current power in W
  source: "local" | "cloud" | "unavailable";
}

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

  const switchIndex = shellySwitchIndex(device.shellyId);

  // 1. Try local IP first (Gen2 API)
  if (device.ipAddress) {
    try {
      const res = await fetch(
        `http://${device.ipAddress}/rpc/Switch.GetStatus?id=${switchIndex}`,
        { signal: AbortSignal.timeout(3000) }
      );
      if (res.ok) {
        const data = await res.json() as { output?: boolean; apower?: number };
        return NextResponse.json({
          online: true,
          output: data.output ?? null,
          power: data.apower,
          source: "local",
        } satisfies ShellyStatus);
      }
    } catch {
      // fall through to Gen1 local
    }

    // Gen1 fallback: /status
    try {
      const res = await fetch(
        `http://${device.ipAddress}/status`,
        { signal: AbortSignal.timeout(3000) }
      );
      if (res.ok) {
        const data = await res.json() as { relays?: { ison?: boolean }[]; meters?: { power?: number }[] };
        const relay = data.relays?.[switchIndex] ?? data.relays?.[0];
        return NextResponse.json({
          online: true,
          output: relay?.ison ?? null,
          power: data.meters?.[switchIndex]?.power ?? data.meters?.[0]?.power,
          source: "local",
        } satisfies ShellyStatus);
      }
    } catch {
      // fall through to cloud
    }
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
    if (entry) {
      const sw = shellySwitchState(entry.status, switchIndex);
      return NextResponse.json({
        online: entry.online,
        output: sw.output,
        power: sw.power,
        source: "cloud",
      } satisfies ShellyStatus);
    }
  }

  return NextResponse.json({ online: false, output: null, source: "unavailable" } satisfies ShellyStatus);
}
