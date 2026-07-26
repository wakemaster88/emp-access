import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { findAreaForIp, findVlanForIp } from "@/lib/ip";

const VALID_TYPES = ["PC", "PRINTER", "CAMERA", "NAS", "PHONE", "IOT", "MONITOR", "OTHER"];

/**
 * Uebernimmt ein vom Hub entdecktes Geraet als regulaeren NetworkClient
 * (mit Name/Typ) und entfernt den Discovered-Eintrag. Ist die MAC bereits
 * als Client erfasst, wird abgebrochen.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const { id } = await params;
  const discoveredId = Number(id);
  if (!Number.isInteger(discoveredId)) {
    return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  }

  const discovered = await db.discoveredDevice.findFirst({
    where: { id: discoveredId, accountId: accountId! },
  });
  if (!discovered) {
    return NextResponse.json({ error: "Gerät nicht gefunden" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "Name ist erforderlich" }, { status: 400 });
  }
  const type = VALID_TYPES.includes(body.type) ? body.type : "OTHER";

  if (discovered.macAddress) {
    const taken = await db.networkClient.findFirst({
      where: { accountId: accountId!, macAddress: discovered.macAddress },
    });
    if (taken) {
      return NextResponse.json(
        { error: "Ein Gerät mit dieser MAC-Adresse existiert bereits" },
        { status: 400 }
      );
    }
  }

  const [vlans, areas] = await Promise.all([
    db.networkVlan.findMany({
      where: { accountId: accountId!, subnet: { not: null } },
      select: { id: true, subnet: true },
    }),
    db.networkArea.findMany({
      where: { accountId: accountId!, ipFrom: { not: null }, ipTo: { not: null } },
      select: { id: true, ipFrom: true, ipTo: true },
    }),
  ]);

  let areaId: number | null = null;
  if (body.areaId) {
    const n = Number(body.areaId);
    const area = await db.networkArea.findFirst({ where: { id: n, accountId: accountId! } });
    if (!area) return NextResponse.json({ error: "Bereich nicht gefunden" }, { status: 400 });
    areaId = n;
  } else {
    areaId = findAreaForIp(discovered.ipAddress, areas)?.id ?? null;
  }

  const client = await db.networkClient.create({
    data: {
      name: body.name.trim(),
      type,
      ipAddress: discovered.ipAddress,
      macAddress: discovered.macAddress,
      isStatic: false,
      vlanId: findVlanForIp(discovered.ipAddress, vlans)?.id ?? null,
      areaId,
      accountId: accountId!,
    },
  });
  await db.discoveredDevice.delete({ where: { id: discoveredId } });

  return NextResponse.json(client, { status: 201 });
}
