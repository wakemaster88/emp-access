import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { shellyControlSchema } from "@/lib/validators";
import { controlShelly, getStatus } from "@/lib/shelly";

export async function GET(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const deviceId = request.nextUrl.searchParams.get("deviceId");
  if (!deviceId) {
    return NextResponse.json({ error: "Missing deviceId" }, { status: 400 });
  }

  const { db } = session;
  const device = await db.device.findFirst({
    where: { id: Number(deviceId), type: "SHELLY" },
  });

  if (!device) {
    return NextResponse.json({ error: "Shelly device not found" }, { status: 404 });
  }

  const status = await getStatus({
    ipAddress: device.ipAddress,
    shellyId: device.shellyId,
    shellyAuthKey: device.shellyAuthKey,
  });

  return NextResponse.json({ device: device.name, ...status });
}

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const body = await request.json();
  const parsed = shellyControlSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { db } = session;
  const device = await db.device.findFirst({
    where: { id: parsed.data.deviceId, type: "SHELLY" },
  });

  if (!device) {
    return NextResponse.json({ error: "Shelly device not found" }, { status: 404 });
  }

  const success = await controlShelly(
    {
      ipAddress: device.ipAddress,
      shellyId: device.shellyId,
      shellyAuthKey: device.shellyAuthKey,
    },
    parsed.data.action,
    parsed.data.timer
  );

  return NextResponse.json({ success, device: device.name, action: parsed.data.action });
}
