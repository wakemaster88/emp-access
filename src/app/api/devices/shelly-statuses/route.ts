import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import {
  shellyBaseId,
  shellyCloudAllStatuses,
  shellySwitchIndex,
  shellySwitchState,
} from "@/lib/shelly-cloud";

export interface ShellyDeviceStatus {
  id: number;
  online: boolean;
  output: boolean | null;
  power?: number;
  source: "local" | "cloud" | "unavailable";
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

  // Ein einziger Cloud-Abruf fuer alle Geraete (Shelly Cloud erlaubt nur
  // ~1 Request/s – Einzelabfragen je Geraet laufen sofort in HTTP 429).
  const cloudStatuses = config?.token && config?.baseUrl
    ? await shellyCloudAllStatuses(config.baseUrl, config.token)
    : null;

  const results = await Promise.all(devices.map(async (device): Promise<ShellyDeviceStatus> => {
    const switchIdx = shellySwitchIndex(device.shellyId);

    // 1. Local
    if (device.ipAddress) {
      const local = await fetchLocal(device.ipAddress, switchIdx);
      if (local) return { id: device.id, ...local, source: "local" };
    }

    // 2. Cloud (aus dem gemeinsamen all_status-Abruf)
    const baseId = shellyBaseId(device.shellyId);
    if (cloudStatuses && baseId) {
      const entry = cloudStatuses.get(baseId) ?? cloudStatuses.get(baseId.toLowerCase());
      if (entry) {
        const sw = shellySwitchState(entry.status, switchIdx);
        return { id: device.id, online: entry.online, output: sw.output, power: sw.power, source: "cloud" };
      }
    }

    return { id: device.id, online: false, output: null, source: "unavailable" };
  }));

  return NextResponse.json(results);
}
