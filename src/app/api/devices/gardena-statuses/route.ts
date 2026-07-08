import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { gardenaStatusMap, type GardenaServiceStatus } from "@/lib/gardena";

export interface GardenaDeviceStatus {
  id: number;
  online: boolean;
  activity: string | null;
  watering: boolean;
  batteryLevel: number | null;
  batteryState: string | null;
  modelType: string | null;
  source: "cloud" | "unavailable";
}

// Batch-Status fuer mehrere GARDENA-Geraete. Ein einziger Cloud-Abruf deckt
// alle Ventile ab (Location-Details enthalten alle Services).
export async function GET(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const idsParam = request.nextUrl.searchParams.get("ids") ?? "";
  const ids = idsParam.split(",").map(Number).filter((n) => !isNaN(n) && n > 0);
  // fresh=1 umgeht den serverseitigen Cache (manueller Refresh, nach Aktionen).
  const fresh = request.nextUrl.searchParams.get("fresh") === "1";
  if (ids.length === 0) return NextResponse.json([]);

  const devices = await db.device.findMany({
    where: { id: { in: ids }, accountId: accountId!, type: "GARDENA_VALVE" },
    select: { id: true, gardenaServiceId: true, gardenaConfigId: true },
  });

  const configs = await db.apiConfig.findMany({
    where: { accountId: accountId!, provider: "GARDENA" },
  });
  const configById = new Map(configs.map((c) => [c.id, c]));

  const unavailable = (id: number): GardenaDeviceStatus => ({
    id,
    online: false,
    activity: null,
    watering: false,
    batteryLevel: null,
    batteryState: null,
    modelType: null,
    source: "unavailable",
  });

  if (configs.length === 0) {
    return NextResponse.json(devices.map((d) => unavailable(d.id)));
  }

  // Welche Verbindungen muessen abgefragt werden? Alle, die von Geraeten
  // referenziert werden, plus die erste als Fallback fuer Alt-Geraete.
  const neededConfigIds = new Set<number>();
  let needFallback = false;
  for (const d of devices) {
    if (d.gardenaConfigId && configById.has(d.gardenaConfigId)) neededConfigIds.add(d.gardenaConfigId);
    else needFallback = true;
  }
  const fallbackId = configs[0]?.id ?? null;
  if (needFallback && fallbackId) neededConfigIds.add(fallbackId);

  // Status je Verbindung holen und nach serviceId zusammenfuehren (serviceIds
  // sind pro Verbindung eindeutig, ein Merge ist daher kollisionsfrei).
  const combined = new Map<string, GardenaServiceStatus>();
  await Promise.all(
    [...neededConfigIds].map(async (cid) => {
      const c = configById.get(cid);
      if (!c?.token || !c?.extraConfig) return;
      const m = await gardenaStatusMap(c.token, c.extraConfig, { fresh });
      for (const [k, v] of m) combined.set(k, v);
    }),
  );

  const results = devices.map((device): GardenaDeviceStatus => {
    const s = device.gardenaServiceId ? combined.get(device.gardenaServiceId) : undefined;
    if (!s) return unavailable(device.id);
    return {
      id: device.id,
      online: s.online,
      activity: s.activity,
      watering: s.watering,
      batteryLevel: s.batteryLevel,
      batteryState: s.batteryState,
      modelType: s.modelType,
      source: "cloud",
    };
  });

  return NextResponse.json(results);
}
