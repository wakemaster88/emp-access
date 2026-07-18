import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

const VALID_TYPES = ["SWITCH", "ROUTER", "ACCESS_POINT", "FIREWALL", "OTHER"];
const MAX_PORTS = 96;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const { id } = await params;
  const deviceId = Number(id);
  if (isNaN(deviceId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const device = await db.networkDevice.findFirst({
    where: { id: deviceId, accountId: accountId! },
    include: {
      ports: {
        include: {
          vlan: true,
          taggedVlans: { include: { vlan: true } },
          outlet: true,
          client: { include: { device: { select: { id: true, name: true, type: true } } } },
        },
        orderBy: { number: "asc" },
      },
    },
  });
  if (!device) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  return NextResponse.json(device);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const { id } = await params;
  const deviceId = Number(id);
  if (isNaN(deviceId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const existing = await db.networkDevice.findFirst({
    where: { id: deviceId, accountId: accountId! },
    include: { ports: { select: { number: true }, orderBy: { number: "desc" }, take: 1 } },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const body = await request.json();
  if (body.type !== undefined && !VALID_TYPES.includes(body.type)) {
    return NextResponse.json({ error: "Ungültiger Gerätetyp" }, { status: 400 });
  }

  const device = await db.networkDevice.update({
    where: { id: deviceId },
    data: {
      name: body.name?.trim() || existing.name,
      type: body.type ?? existing.type,
      vendor: body.vendor !== undefined ? (body.vendor?.trim() || null) : existing.vendor,
      model: body.model !== undefined ? (body.model?.trim() || null) : existing.model,
      ipAddress: body.ipAddress !== undefined ? (body.ipAddress?.trim() || null) : existing.ipAddress,
      macAddress: body.macAddress !== undefined ? (body.macAddress?.trim() || null) : existing.macAddress,
      location: body.location !== undefined ? (body.location?.trim() || null) : existing.location,
      notes: body.notes !== undefined ? (body.notes?.trim() || null) : existing.notes,
    },
  });

  // Optional: weitere Ports anhaengen (bestehende bleiben unberuehrt).
  if (body.addPorts !== undefined) {
    const addPorts = Number(body.addPorts);
    const highest = existing.ports[0]?.number ?? 0;
    if (!Number.isInteger(addPorts) || addPorts < 1 || highest + addPorts > MAX_PORTS) {
      return NextResponse.json({ error: `Ungültige Port-Anzahl (max. ${MAX_PORTS} gesamt)` }, { status: 400 });
    }
    await db.networkPort.createMany({
      data: Array.from({ length: addPorts }, (_, i) => ({
        deviceId,
        number: highest + i + 1,
      })),
    });
  }

  return NextResponse.json(device);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const { id } = await params;
  const deviceId = Number(id);
  if (isNaN(deviceId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const existing = await db.networkDevice.findFirst({
    where: { id: deviceId, accountId: accountId! },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  await db.networkDevice.delete({ where: { id: deviceId } });
  return NextResponse.json({ ok: true });
}
