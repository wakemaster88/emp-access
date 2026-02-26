import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

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

  // Shelly Cloud uses 1-based channel suffixes in device IDs (e.g. "abc123_1" = switch:0).
  // Single-channel devices may have no suffix (channel = 0) or _1 (switch:0).
  const channelSuffix = device.shellyId?.includes("_")
    ? Number(device.shellyId.split("_").pop())
    : 0;
  const safeSuffix = isNaN(channelSuffix) ? 0 : channelSuffix;
  // Map cloud suffix to 0-based switch index: _1 → 0, _2 → 1, 0 → 0
  const switchIndex = safeSuffix > 0 ? safeSuffix - 1 : 0;

  // Helper: look up "switch:N" in a flat device_status object (keys contain colon)
  type SwitchEntry = { output?: boolean; apower?: number };
  type DeviceStatus = Record<string, unknown>;
  function findSwitch(status: DeviceStatus, idx: number): SwitchEntry | undefined {
    const direct = status[`switch:${idx}`] as SwitchEntry | undefined;
    if (direct !== undefined) return direct;
    // Fallback: search any switch:N key
    for (let i = 0; i <= 4; i++) {
      const entry = status[`switch:${i}`] as SwitchEntry | undefined;
      if (entry !== undefined) return entry;
    }
    return undefined;
  }

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

  // 2. Try Shelly Cloud
  const shellyBaseId = device.shellyId?.split("_")[0] ?? device.shellyId;
  const config = await db.apiConfig.findFirst({
    where: { accountId: accountId!, provider: "SHELLY" },
  });

  if (config?.token && config?.baseUrl && shellyBaseId) {
    const baseUrl = `https://${config.baseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
    try {
      const res = await fetch(`${baseUrl}/device/status`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ auth_key: config.token.trim(), id: shellyBaseId }),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json() as {
          isok?: boolean;
          data?: {
            online?: boolean;
            device_status?: DeviceStatus & { relays?: { ison?: boolean }[] };
          };
        };

        if (data.isok && data.data) {
          // online is at data.data.online, NOT inside device_status
          const online = data.data.online ?? false;
          const status = data.data.device_status ?? {};

          // Gen2: flat keys "switch:0", "switch:1", ...
          const sw = findSwitch(status, switchIndex);
          if (sw !== undefined) {
            return NextResponse.json({
              online,
              output: sw.output ?? null,
              power: sw.apower,
              source: "cloud",
            } satisfies ShellyStatus);
          }

          // Gen1: relays array
          const relay = (status.relays as { ison?: boolean }[] | undefined)?.[switchIndex]
            ?? (status.relays as { ison?: boolean }[] | undefined)?.[0];
          return NextResponse.json({
            online,
            output: relay?.ison ?? null,
            source: "cloud",
          } satisfies ShellyStatus);
        }
      }
    } catch {
      // unavailable
    }
  }

  return NextResponse.json({ online: false, output: null, source: "unavailable" } satisfies ShellyStatus);
}
