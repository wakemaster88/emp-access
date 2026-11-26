import { NextRequest, NextResponse, after } from "next/server";
import { getSessionWithDb, validateApiToken } from "@/lib/api-auth";
import {
  triggerDeviceAction,
  isValidDeviceAction,
  isActionAllowedForDevice,
  deviceSendsRemoteCommand,
} from "@/lib/device-open";
import { isAudioDevice } from "@/lib/device-controls";
import { audioInputFromDeviceAction, controlAudioDevice } from "@/lib/audio-integration";
import { actionSucceeded, runDeviceSwitchedRules } from "@/lib/room-rules";
import { hubTaskActor, type HubTaskActor } from "@/lib/hub-task-rules";

function hasApiToken(request: NextRequest) {
  return request.nextUrl.searchParams.has("token") || request.headers.has("authorization");
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let db, accountId: number;
  let by: HubTaskActor | undefined;
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
    by = hubTaskActor(session.session.user);
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

  const { task, sent, error, hubTaskId } = await triggerDeviceAction(
    db,
    existing,
    accountId!,
    action,
    {
      seconds,
      by,
      // Protokoll: angemeldeter Benutzer. Mit Account-Token schalten auch
      // Automatiken (Hub, Schranke) – die Quelle bleibt dann "unbekannt".
      actor: by ? { source: "admin", actorId: by.adminId } : { source: "unbekannt", actorLabel: "API-Token" },
      switched: { action, depth: 0 },
    },
  );

  // Raumregeln, die an diesem Schaltvorgang haengen. Nur wenn das Geraet den
  // Befehl angenommen hat (actionSucceeded). Der Knopf in der Oberflaeche
  // wartet nicht darauf; after() haelt die Funktion bis zum Ende der Regeln
  // am Leben, die Plattform friert sie sonst nach der Antwort ein. An den
  // Hub uebergeben (Hue): Sie starten mit seinem Ergebnis.
  if (actionSucceeded(existing.type, { sent, error }) && hubTaskId == null) {
    after(() =>
      runDeviceSwitchedRules(accountId!, existing.id, action).catch((err) => {
        console.error("[device action] room rules failed:", err);
      }),
    );
  }

  const hasRemoteAction = deviceSendsRemoteCommand(existing.type);
  return NextResponse.json({
    ok: true,
    task,
    sent: hasRemoteAction ? sent : undefined,
    error,
  });
}
