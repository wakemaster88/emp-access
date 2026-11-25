import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb, isTenantAdminRole } from "@/lib/api-auth";
import { newPublicToken } from "@/lib/tokens";
import { checkMonitorRefs, monitorIdList } from "@/lib/monitor-refs";

export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const monitors = await db.monitorConfig.findMany({
    where: { accountId: accountId! },
    orderBy: { createdAt: "desc" },
  });
  // Der Link-Token öffnet den Monitor ohne Login: nur für die Verwaltungs-Rolle.
  if (isTenantAdminRole(session.session.user.role)) return NextResponse.json(monitors);
  return NextResponse.json(
    monitors.map((monitor) => {
      const view: Partial<typeof monitor> = { ...monitor };
      delete view.token;
      return view;
    }),
  );
}

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb({ requireAdmin: true });
  if ("error" in session) return session.error;

  const body = await request.json();
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "Name ist erforderlich" }, { status: 400 });
  }

  const { db, accountId } = session;
  const type =
    body.type === "CHECKIN"
      ? "CHECKIN"
      : body.type === "RESOURCE_MONITOR"
        ? "RESOURCE_MONITOR"
        : body.type === "SCANNER"
          ? "SCANNER"
          : body.type === "VOUCHER"
            ? "VOUCHER"
            : "MONITOR";
  // Geraete und Bereiche muessen zum Mandanten gehoeren.
  const checked = await checkMonitorRefs(db, accountId, type, {
    deviceIds: monitorIdList(body.deviceIds) ?? [],
    areaIds: monitorIdList(body.areaIds) ?? [],
    controlDeviceIds: type === "MONITOR" ? (monitorIdList(body.controlDeviceIds) ?? []) : [],
  });
  if ("error" in checked) return NextResponse.json({ error: checked.error }, { status: 400 });
  const { lists } = checked;

  const monitor = await db.monitorConfig.create({
    data: {
      name: body.name.trim(),
      token: newPublicToken(),
      type,
      deviceIds: lists.deviceIds,
      areaIds: lists.areaIds,
      controlDeviceIds: lists.controlDeviceIds,
      isActive: body.isActive ?? true,
      accountId: accountId!,
    },
  });
  return NextResponse.json(monitor, { status: 201 });
}
