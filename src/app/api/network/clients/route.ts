import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { findAreaForIp, findVlanForIp } from "@/lib/ip";

const VALID_TYPES = ["PC", "PRINTER", "CAMERA", "NAS", "PHONE", "IOT", "MONITOR", "OTHER"];

export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const clients = await db.networkClient.findMany({
    where: { accountId: accountId! },
    include: {
      device: { select: { id: true, name: true, type: true, ipAddress: true, lastUpdate: true } },
      port: { include: { device: { select: { id: true, name: true } } } },
      vlan: true,
      area: { select: { id: true, name: true, sortOrder: true, vlanId: true } },
    },
    orderBy: { name: "asc" },
    take: 2000,
  });
  return NextResponse.json(clients);
}

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const body = await request.json();
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "Name ist erforderlich" }, { status: 400 });
  }
  if (body.type !== undefined && body.type !== null && !VALID_TYPES.includes(body.type)) {
    return NextResponse.json({ error: "Ungültiger Geräte-Typ" }, { status: 400 });
  }

  // Optionaler Link auf ein IoT-Device (max. 1 NetworkClient pro Device).
  let deviceId: number | null = null;
  if (body.deviceId) {
    const n = Number(body.deviceId);
    const device = await db.device.findFirst({ where: { id: n, accountId: accountId! } });
    if (!device) return NextResponse.json({ error: "Gerät nicht gefunden" }, { status: 400 });
    const taken = await db.networkClient.findFirst({ where: { deviceId: n } });
    if (taken) return NextResponse.json({ error: "Gerät ist bereits als Netzwerkgerät erfasst" }, { status: 400 });
    deviceId = n;
  }

  // Optionaler Switch-Port (max. 1 Client pro Port).
  let portId: number | null = null;
  if (body.portId) {
    const n = Number(body.portId);
    const port = await db.networkPort.findFirst({ where: { id: n, device: { accountId: accountId! } } });
    if (!port) return NextResponse.json({ error: "Port nicht gefunden" }, { status: 400 });
    const taken = await db.networkClient.findFirst({ where: { portId: n } });
    if (taken) return NextResponse.json({ error: "Port ist bereits belegt" }, { status: 400 });
    portId = n;
  }

  const ipAddress: string | null = body.ipAddress?.trim() || null;

  let vlanId: number | null = null;
  if (body.vlanId) {
    const n = Number(body.vlanId);
    const vlan = await db.networkVlan.findFirst({ where: { id: n, accountId: accountId! } });
    if (!vlan) return NextResponse.json({ error: "VLAN nicht gefunden" }, { status: 400 });
    vlanId = n;
  } else if (ipAddress) {
    // Automatische VLAN-Erkennung: IP gegen die VLAN-Subnetze matchen.
    const vlans = await db.networkVlan.findMany({
      where: { accountId: accountId!, subnet: { not: null } },
      select: { id: true, subnet: true },
    });
    vlanId = findVlanForIp(ipAddress, vlans)?.id ?? null;
  }

  let areaId: number | null = null;
  if (body.areaId) {
    const n = Number(body.areaId);
    const area = await db.networkArea.findFirst({ where: { id: n, accountId: accountId! } });
    if (!area) return NextResponse.json({ error: "Bereich nicht gefunden" }, { status: 400 });
    areaId = n;
  } else if (ipAddress) {
    const areas = await db.networkArea.findMany({
      where: { accountId: accountId!, ipFrom: { not: null }, ipTo: { not: null } },
      select: { id: true, ipFrom: true, ipTo: true },
    });
    areaId = findAreaForIp(ipAddress, areas)?.id ?? null;
  }

  const client = await db.networkClient.create({
    data: {
      name: body.name.trim(),
      type: body.type ?? "OTHER",
      ipAddress,
      macAddress: body.macAddress?.trim() || null,
      isStatic: body.isStatic ?? false,
      deviceId,
      portId,
      vlanId,
      areaId,
      notes: body.notes?.trim() || null,
      accountId: accountId!,
    },
  });
  return NextResponse.json(client, { status: 201 });
}
