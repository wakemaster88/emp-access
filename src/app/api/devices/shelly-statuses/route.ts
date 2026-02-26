import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

export interface ShellyDeviceStatus {
  id: number;
  online: boolean;
  output: boolean | null;
  power?: number;
  source: "local" | "cloud" | "unavailable";
}

// Shelly Cloud uses 1-based suffixes (_1 = switch:0). Map to 0-based switch index.
function toSwitchIndex(channelSuffix: number): number {
  return channelSuffix > 0 ? channelSuffix - 1 : 0;
}

type SwitchEntry = { output?: boolean; apower?: number };
type DeviceStatusMap = Record<string, unknown>;

function findSwitch(status: DeviceStatusMap, idx: number): SwitchEntry | undefined {
  const direct = status[`switch:${idx}`] as SwitchEntry | undefined;
  if (direct !== undefined) return direct;
  for (let i = 0; i <= 4; i++) {
    const entry = status[`switch:${i}`] as SwitchEntry | undefined;
    if (entry !== undefined) return entry;
  }
  return undefined;
}

async function fetchLocal(ip: string, switchIdx: number): Promise<{ online: true; output: boolean | null; power?: number } | null> {
  // Gen2
  try {
    const res = await fetch(`http://${ip}/rpc/Switch.GetStatus?id=${switchIdx}`, {
      signal: AbortSignal.timeout(1500),
    });
    if (res.ok) {
      const d = await res.json() as { output?: boolean; apower?: number };
      return { online: true, output: d.output ?? null, power: d.apower };
    }
  } catch { /* try Gen1 */ }

  // Gen1
  try {
    const res = await fetch(`http://${ip}/status`, { signal: AbortSignal.timeout(1500) });
    if (res.ok) {
      const d = await res.json() as { relays?: { ison?: boolean }[]; meters?: { power?: number }[] };
      const relay = d.relays?.[switchIdx] ?? d.relays?.[0];
      return { online: true, output: relay?.ison ?? null, power: d.meters?.[switchIdx]?.power ?? d.meters?.[0]?.power };
    }
  } catch { /* unavailable */ }

  return null;
}

export async function GET(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const idsParam = request.nextUrl.searchParams.get("ids") ?? "";
  const ids = idsParam.split(",").map(Number).filter((n) => !isNaN(n) && n > 0);

  if (ids.length === 0) return NextResponse.json([]);

  const devices = await db.device.findMany({
    where: { id: { in: ids }, accountId: accountId!, type: "SHELLY" },
    select: { id: true, ipAddress: true, shellyId: true },
  });

  // Load saved Shelly Cloud config once
  const config = await db.apiConfig.findFirst({
    where: { accountId: accountId!, provider: "SHELLY" },
  });

  const cloudBaseUrl = config?.token && config?.baseUrl
    ? `https://${config.baseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}`
    : null;

  // Fetch all statuses in parallel
  const results = await Promise.all(devices.map(async (device): Promise<ShellyDeviceStatus> => {
    const channelSuffix = device.shellyId?.includes("_")
      ? (Number(device.shellyId.split("_").pop()) || 0)
      : 0;
    const switchIdx = toSwitchIndex(channelSuffix);

    // 1. Local
    if (device.ipAddress) {
      const local = await fetchLocal(device.ipAddress, switchIdx);
      if (local) return { id: device.id, ...local, source: "local" };
    }

    // 2. Cloud
    const baseId = device.shellyId?.split("_")[0] ?? device.shellyId;
    if (cloudBaseUrl && config?.token && baseId) {
      try {
        const res = await fetch(`${cloudBaseUrl}/device/status`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ auth_key: config.token.trim(), id: baseId }),
          signal: AbortSignal.timeout(4000),
        });
        if (res.ok) {
          const data = await res.json() as {
            isok?: boolean;
            data?: {
              online?: boolean;
              device_status?: DeviceStatusMap & { relays?: { ison?: boolean }[] };
            };
          };
          if (data.isok && data.data) {
            // online is at data.data.online, not inside device_status
            const online = data.data.online ?? false;
            const s = data.data.device_status ?? {};
            const sw = findSwitch(s, switchIdx);
            if (sw !== undefined) {
              return { id: device.id, online, output: sw.output ?? null, power: sw.apower, source: "cloud" };
            }
            const relay = (s.relays as { ison?: boolean }[] | undefined)?.[switchIdx]
              ?? (s.relays as { ison?: boolean }[] | undefined)?.[0];
            return { id: device.id, online, output: relay?.ison ?? null, source: "cloud" };
          }
        }
      } catch { /* unavailable */ }
    }

    return { id: device.id, online: false, output: null, source: "unavailable" };
  }));

  return NextResponse.json(results);
}
