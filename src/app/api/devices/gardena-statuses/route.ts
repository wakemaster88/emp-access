import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { gardenaStatusMap } from "@/lib/gardena";

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
  if (ids.length === 0) return NextResponse.json([]);

  const devices = await db.device.findMany({
    where: { id: { in: ids }, accountId: accountId!, type: "GARDENA_VALVE" },
    select: { id: true, gardenaServiceId: true },
  });

  const config = await db.apiConfig.findFirst({
    where: { accountId: accountId!, provider: "GARDENA" },
  });

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

  if (!config?.token || !config?.extraConfig) {
    return NextResponse.json(devices.map((d) => unavailable(d.id)));
  }

  const statusMap = await gardenaStatusMap(config.token, config.extraConfig);

  const results = devices.map((device): GardenaDeviceStatus => {
    const s = device.gardenaServiceId ? statusMap.get(device.gardenaServiceId) : undefined;
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
