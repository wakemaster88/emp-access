import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { findVlanForIp } from "@/lib/ip";

const VALID_TYPES = ["PC", "PRINTER", "CAMERA", "NAS", "PHONE", "IOT", "MONITOR", "OTHER"];

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const { id } = await params;
  const clientId = Number(id);
  if (isNaN(clientId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const existing = await db.networkClient.findFirst({
    where: { id: clientId, accountId: accountId! },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const body = await request.json();
  if (body.type !== undefined && !VALID_TYPES.includes(body.type)) {
    return NextResponse.json({ error: "Ungültiger Geräte-Typ" }, { status: 400 });
  }

  let deviceId = existing.deviceId;
  if (body.deviceId !== undefined) {
    if (body.deviceId === null || body.deviceId === 0 || body.deviceId === "none") {
      deviceId = null;
    } else {
      const n = Number(body.deviceId);
      const device = await db.device.findFirst({ where: { id: n, accountId: accountId! } });
      if (!device) return NextResponse.json({ error: "Gerät nicht gefunden" }, { status: 400 });
      const taken = await db.networkClient.findFirst({ where: { deviceId: n, NOT: { id: clientId } } });
      if (taken) return NextResponse.json({ error: "Gerät ist bereits als Netzwerkgerät erfasst" }, { status: 400 });
      deviceId = n;
    }
  }

  let portId = existing.portId;
  if (body.portId !== undefined) {
    if (body.portId === null || body.portId === 0 || body.portId === "none") {
      portId = null;
    } else {
      const n = Number(body.portId);
      const port = await db.networkPort.findFirst({ where: { id: n, device: { accountId: accountId! } } });
      if (!port) return NextResponse.json({ error: "Port nicht gefunden" }, { status: 400 });
      const taken = await db.networkClient.findFirst({ where: { portId: n, NOT: { id: clientId } } });
      if (taken) return NextResponse.json({ error: "Port ist bereits belegt" }, { status: 400 });
      portId = n;
    }
  }

  const newIp = body.ipAddress !== undefined ? (body.ipAddress?.trim() || null) : existing.ipAddress;

  let vlanId = existing.vlanId;
  if (body.vlanId !== undefined) {
    if (body.vlanId === null || body.vlanId === 0 || body.vlanId === "none") {
      vlanId = null;
    } else {
      const n = Number(body.vlanId);
      const vlan = await db.networkVlan.findFirst({ where: { id: n, accountId: accountId! } });
      if (!vlan) return NextResponse.json({ error: "VLAN nicht gefunden" }, { status: 400 });
      vlanId = n;
    }
  }
  // Automatische VLAN-Erkennung, wenn das VLAN-Feld nicht angefasst wurde
  // und bisher kein VLAN gesetzt ist (explizites "Kein VLAN" bleibt erhalten,
  // manuell gewaehlte VLANs werden nie ueberschrieben).
  if (body.vlanId === undefined && vlanId === null && newIp) {
    const vlans = await db.networkVlan.findMany({
      where: { accountId: accountId!, subnet: { not: null } },
      select: { id: true, subnet: true },
    });
    vlanId = findVlanForIp(newIp, vlans)?.id ?? null;
  }

  const client = await db.networkClient.update({
    where: { id: clientId },
    data: {
      name: body.name?.trim() || existing.name,
      type: body.type ?? existing.type,
      ipAddress: newIp,
      macAddress: body.macAddress !== undefined ? (body.macAddress?.trim() || null) : existing.macAddress,
      isStatic: typeof body.isStatic === "boolean" ? body.isStatic : existing.isStatic,
      deviceId,
      portId,
      vlanId,
      notes: body.notes !== undefined ? (body.notes?.trim() || null) : existing.notes,
    },
  });
  return NextResponse.json(client);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const { id } = await params;
  const clientId = Number(id);
  if (isNaN(clientId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const existing = await db.networkClient.findFirst({
    where: { id: clientId, accountId: accountId! },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  await db.networkClient.delete({ where: { id: clientId } });
  return NextResponse.json({ ok: true });
}
