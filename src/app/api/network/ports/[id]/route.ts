import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

const VALID_STATUS = ["ACTIVE", "INACTIVE", "RESERVED", "FAULTY"];

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const { id } = await params;
  const portId = Number(id);
  if (isNaN(portId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  // Account-Zugehoerigkeit ueber das Geraet pruefen.
  const existing = await db.networkPort.findFirst({
    where: { id: portId, device: { accountId: accountId! } },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const body = await request.json();
  if (body.status !== undefined && !VALID_STATUS.includes(body.status)) {
    return NextResponse.json({ error: "Ungültiger Status" }, { status: 400 });
  }

  // Untagged VLAN prüfen (muss zum Account gehören).
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

  // Anschluss/Dose prüfen (muss zum Account gehören und darf nicht schon
  // an einem anderen Port hängen).
  let outletId = existing.outletId;
  if (body.outletId !== undefined) {
    if (body.outletId === null || body.outletId === 0 || body.outletId === "none") {
      outletId = null;
    } else {
      const n = Number(body.outletId);
      const outlet = await db.networkOutlet.findFirst({ where: { id: n, accountId: accountId! } });
      if (!outlet) return NextResponse.json({ error: "Anschluss nicht gefunden" }, { status: 400 });
      const taken = await db.networkPort.findFirst({ where: { outletId: n, NOT: { id: portId } } });
      if (taken) return NextResponse.json({ error: "Anschluss ist bereits mit einem anderen Port verbunden" }, { status: 400 });
      outletId = n;
    }
  }

  const port = await db.networkPort.update({
    where: { id: portId },
    data: {
      label: body.label !== undefined ? (body.label?.trim() || null) : existing.label,
      vlanId,
      outletId,
      poe: typeof body.poe === "boolean" ? body.poe : existing.poe,
      uplink: typeof body.uplink === "boolean" ? body.uplink : existing.uplink,
      status: body.status ?? existing.status,
      notes: body.notes !== undefined ? (body.notes?.trim() || null) : existing.notes,
    },
  });

  // Tagged VLANs komplett ersetzen, wenn mitgeschickt.
  if (Array.isArray(body.taggedVlanIds)) {
    const ids = body.taggedVlanIds.map(Number).filter((n: number) => Number.isInteger(n));
    const owned = await db.networkVlan.findMany({
      where: { id: { in: ids }, accountId: accountId! },
      select: { id: true },
    });
    const ownedIds = owned.map((v) => v.id);
    await db.networkPortVlan.deleteMany({ where: { portId } });
    if (ownedIds.length > 0) {
      await db.networkPortVlan.createMany({
        data: ownedIds.map((vId) => ({ portId, vlanId: vId })),
      });
    }
  }

  const full = await db.networkPort.findFirst({
    where: { id: portId },
    include: {
      vlan: true,
      taggedVlans: { include: { vlan: true } },
      outlet: true,
      client: { include: { device: { select: { id: true, name: true, type: true } } } },
    },
  });
  return NextResponse.json(full ?? port);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const { id } = await params;
  const portId = Number(id);
  if (isNaN(portId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const existing = await db.networkPort.findFirst({
    where: { id: portId, device: { accountId: accountId! } },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  await db.networkPort.delete({ where: { id: portId } });
  return NextResponse.json({ ok: true });
}
