import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

const VALID_TYPES = ["SWITCH", "ROUTER", "ACCESS_POINT", "FIREWALL", "OTHER"];
const MAX_PORTS = 96;

export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const devices = await db.networkDevice.findMany({
    where: { accountId: accountId! },
    include: { _count: { select: { ports: true } } },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(devices);
}

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const body = await request.json();
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "Name ist erforderlich" }, { status: 400 });
  }
  if (!VALID_TYPES.includes(body.type)) {
    return NextResponse.json({ error: "Ungültiger Gerätetyp" }, { status: 400 });
  }

  let portCount = 0;
  if (body.portCount !== undefined && body.portCount !== null && body.portCount !== "") {
    portCount = Number(body.portCount);
    if (!Number.isInteger(portCount) || portCount < 0 || portCount > MAX_PORTS) {
      return NextResponse.json({ error: `Port-Anzahl muss zwischen 0 und ${MAX_PORTS} liegen` }, { status: 400 });
    }
  }

  const device = await db.networkDevice.create({
    data: {
      name: body.name.trim(),
      type: body.type,
      vendor: body.vendor?.trim() || null,
      model: body.model?.trim() || null,
      ipAddress: body.ipAddress?.trim() || null,
      macAddress: body.macAddress?.trim() || null,
      location: body.location?.trim() || null,
      notes: body.notes?.trim() || null,
      accountId: accountId!,
      // Ports automatisch generieren, damit sie nicht einzeln angelegt
      // werden muessen (Port 1..n).
      ports: portCount > 0
        ? { create: Array.from({ length: portCount }, (_, i) => ({ number: i + 1 })) }
        : undefined,
    },
    include: { _count: { select: { ports: true } } },
  });

  return NextResponse.json(device, { status: 201 });
}
