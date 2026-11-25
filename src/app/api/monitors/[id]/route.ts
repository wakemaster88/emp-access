import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { checkMonitorRefs, monitorIdList } from "@/lib/monitor-refs";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb({ requireAdmin: true });
  if ("error" in session) return session.error;

  const { id } = await params;
  const monitorId = Number(id);
  if (isNaN(monitorId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const body = await request.json();
  const { db, accountId } = session;

  const existing = await db.monitorConfig.findFirst({
    where: { id: monitorId, accountId: accountId! },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const type =
    body.type === "CHECKIN"
      ? "CHECKIN"
      : body.type === "RESOURCE_MONITOR"
        ? "RESOURCE_MONITOR"
        : body.type === "SCANNER"
          ? "SCANNER"
          : body.type === "VOUCHER"
            ? "VOUCHER"
            : body.type === "MONITOR"
            ? "MONITOR"
            : existing.type;
  const deviceIds = monitorIdList(body.deviceIds);
  const areaIds = monitorIdList(body.areaIds);
  const controlDeviceIds = monitorIdList(body.controlDeviceIds);
  const before = {
    deviceIds: monitorIdList(existing.deviceIds) ?? [],
    areaIds: monitorIdList(existing.areaIds) ?? [],
    controlDeviceIds: monitorIdList(existing.controlDeviceIds) ?? [],
  };
  // Neu eingetragene Geraete und Bereiche muessen zum Mandanten gehoeren;
  // bei einem Typwechsel wird die ganze deviceIds-Liste geprueft.
  const checked = await checkMonitorRefs(
    db,
    accountId,
    type,
    {
      deviceIds: deviceIds ?? before.deviceIds,
      areaIds: areaIds ?? before.areaIds,
      controlDeviceIds: controlDeviceIds ?? before.controlDeviceIds,
    },
    before,
    type !== existing.type,
  );
  if ("error" in checked) return NextResponse.json({ error: checked.error }, { status: 400 });

  const monitor = await db.monitorConfig.update({
    where: { id: monitorId },
    data: {
      name: body.name?.trim() ?? existing.name,
      type,
      deviceIds:
        deviceIds !== undefined || type !== existing.type
          ? checked.lists.deviceIds
          : (existing.deviceIds ?? []),
      areaIds: areaIds ?? existing.areaIds ?? [],
      controlDeviceIds: controlDeviceIds ?? existing.controlDeviceIds ?? [],
      isActive: body.isActive ?? existing.isActive,
    },
  });
  return NextResponse.json(monitor);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb({ requireAdmin: true });
  if ("error" in session) return session.error;

  const { id } = await params;
  const monitorId = Number(id);
  if (isNaN(monitorId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const { db, accountId } = session;

  const existing = await db.monitorConfig.findFirst({
    where: { id: monitorId, accountId: accountId! },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  await db.monitorConfig.delete({ where: { id: monitorId } });
  return NextResponse.json({ ok: true });
}
