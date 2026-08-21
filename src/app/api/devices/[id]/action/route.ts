import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb, validateApiToken } from "@/lib/api-auth";
import {
  triggerDeviceAction,
  isValidDeviceAction,
  isActionAllowedForDevice,
  deviceSendsRemoteCommand,
} from "@/lib/device-open";
import { isAudioDevice } from "@/lib/device-controls";
import { audioInputFromDeviceAction, controlAudioDevice } from "@/lib/audio-integration";

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

  if (!isValidDeviceAction(action)) {
    return NextResponse.json({ error: "Ungültige Aktion" }, { status: 400 });
  }

  const existing = await db.device.findFirst({
    where: { id: deviceId, accountId: accountId! },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  if (!isActionAllowedForDevice(action, existing)) {
    return NextResponse.json(
      { error: "Aktion ist für dieses Gerät nicht vorgesehen" },
      { status: 400 },
    );
  }

  if (isAudioDevice(existing)) {
    const input = audioInputFromDeviceAction(action);
    if (!input) {
      return NextResponse.json(
        { error: "Aktion ist für dieses Gerät nicht vorgesehen" },
        { status: 400 },
      );
    }
    const result = await controlAudioDevice(db, accountId!, existing, input);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ok: true, sent: true });
  }

  const { task, sent, error } = await triggerDeviceAction(
    db,
    existing,
    accountId!,
    action,
    { seconds },
  );

  const hasRemoteAction = deviceSendsRemoteCommand(existing.type);
  return NextResponse.json({
    ok: true,
    task,
    sent: hasRemoteAction ? sent : undefined,
    error,
  });
}
