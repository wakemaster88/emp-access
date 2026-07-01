import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb, validateApiToken } from "@/lib/api-auth";
import { triggerDeviceAction, DEVICE_TASK_MAP } from "@/lib/device-open";

function hasApiToken(request: NextRequest) {
  return request.nextUrl.searchParams.has("token") || request.headers.has("authorization");
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let db, accountId: number;
  if (hasApiToken(request)) {
    const auth = await validateApiToken(request);
    if ("error" in auth) return auth.error;
    db = auth.db;
    accountId = auth.account.id;
  } else {
    const session = await getSessionWithDb();
    if ("error" in session) return session.error;
    db = session.db;
    accountId = session.accountId!;
  }

  const { id } = await params;
  const deviceId = Number(id);
  if (isNaN(deviceId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const body = await request.json();
  const action = body.action as string;
  // Optionale Bewässerungsdauer (Minuten) fuer GARDENA-Ventile.
  const minutes = Number(body.minutes);
  const seconds = Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes * 60) : undefined;

  if (!(action in DEVICE_TASK_MAP)) {
    return NextResponse.json({ error: "Ungültige Aktion" }, { status: 400 });
  }

  const existing = await db.device.findFirst({
    where: { id: deviceId, accountId: accountId! },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const { task, sent } = await triggerDeviceAction(
    db,
    existing,
    accountId!,
    action as keyof typeof DEVICE_TASK_MAP,
    { seconds },
  );

  const hasRemoteAction =
    existing.type === "SHELLY" ||
    existing.type === "NUKI_SMARTLOCK" ||
    existing.type === "GARDENA_VALVE";
  return NextResponse.json({ ok: true, task, sent: hasRemoteAction ? sent : undefined });
}
