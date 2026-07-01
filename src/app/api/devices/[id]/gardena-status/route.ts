import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { gardenaStatusMap } from "@/lib/gardena";

export interface GardenaStatus {
  online: boolean;
  activity: string | null;
  watering: boolean;
  batteryLevel: number | null;
  batteryState: string | null;
  rfLinkLevel: number | null;
  modelType: string | null;
  source: "cloud" | "unavailable";
}

const UNAVAILABLE: GardenaStatus = {
  online: false,
  activity: null,
  watering: false,
  batteryLevel: null,
  batteryState: null,
  rfLinkLevel: null,
  modelType: null,
  source: "unavailable",
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { id } = await params;
  const deviceId = Number(id);
  if (isNaN(deviceId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const { db, accountId } = session;
  const device = await db.device.findFirst({
    where: { id: deviceId, accountId: accountId!, type: "GARDENA_VALVE" },
  });
  if (!device) return NextResponse.json({ error: "Gerät nicht gefunden" }, { status: 404 });

  const config = device.gardenaConfigId
    ? await db.apiConfig.findFirst({ where: { id: device.gardenaConfigId, accountId: accountId! } })
    : await db.apiConfig.findFirst({ where: { accountId: accountId!, provider: "GARDENA" } });
  if (!config?.token || !config?.extraConfig || !device.gardenaServiceId) {
    return NextResponse.json(UNAVAILABLE);
  }

  const statusMap = await gardenaStatusMap(config.token, config.extraConfig);
  const s = statusMap.get(device.gardenaServiceId);
  if (!s) return NextResponse.json(UNAVAILABLE);

  return NextResponse.json({ ...s, source: "cloud" } satisfies GardenaStatus);
}
