import { NextRequest, NextResponse } from "next/server";
import { adminRoleRequired, getSessionWithDb, isTenantAdminRole, validateApiToken } from "@/lib/api-auth";
import { hubTaskAllowedForUser, hubTaskListFilter } from "@/lib/role-guards";
import {
  EXPIRED_TASK_ERROR,
  SCAN_SNAPSHOT_TYPE,
  checkHubTaskPayload,
  expiredSwitchCommandsWhere,
  hubTaskActor,
  withActor,
} from "@/lib/hub-task-rules";
import { recordDeviceAction } from "@/lib/device-action-log";
import { doorHoldTaskPayload, doorHoldTaskPlan, type DoorHoldTaskPlan } from "@/lib/door-hold";
import { PREVIEW_BLOCKED_ERROR, previewAllowed } from "@/lib/camera-live-mode";

/** Tuer-Auftraege an Kamera-Tueren, die im Geraete-Protokoll stehen. */
const LOGGED_DOOR_TASKS: Record<string, string> = {
  DOORBIRD_OPEN: "doorbird_open",
  DOORBIRD_HOLD: "doorbird_hold",
};

/** Hoechstens so viele Auftraege je Abholung. */
const PICKUP_LIMIT = 10;

function hasApiToken(request: NextRequest) {
  return request.nextUrl.searchParams.has("token") || request.headers.has("authorization");
}

const VALID_TASK_TYPES = [
  "PING",
  "NETWORK_SCAN",
  "WAKE_ON_LAN",
  "CAMERA_SNAPSHOT",
  "FACE_ENROLL",
  // Unbekannte Sichtungen nachtraeglich analysieren (payload.sightingIds).
  "FACE_ANALYZE",
  "DOORBIRD_OPEN",
  // Tor offen halten: Hub loest das Relais bis payload.until im Takt aus (null = beenden).
  "DOORBIRD_HOLD",
  "CAMERA_PTZ",
  "CAMERA_SPOTLIGHT",
  "CAMERA_IR",
  "CAMERA_SIREN",
  "CAMERA_PTZ_PRESETS",
  // Regel-Aktion „Kamera steuern“: Preset anfahren, automatisch folgen an/aus.
  "CAMERA_SCENE",
  "SWITCH_SYNC",
  // Log-Ausschnitt vom Hub abrufen (Netzwerk-Seite, Karte „Lokaler Hub“).
  "HUB_LOG",
  // Tracker oder Hub neu starten – der Hub kennt nur diese beiden Dienste.
  "SERVICE_RESTART",
  // Auto-Login/Ruhezustand/Einschaltplan des Hub-Macs sofort neu lesen.
  "SYSTEM_CHECK",
  // Soundweb London: Regler setzen bzw. Konfiguration neu laden (Audio → Soundweb).
  "SOUNDWEB_SET",
  "SOUNDWEB_SYNC",
  // Shelly im LAN: Status lesen bzw. Relais schalten (payload: host, channel, on).
  "SHELLY_STATUS",
  // Philips Hue im LAN schalten (payload: bridgeId, lightId, on, deviceId).
  "HUE_SET",
  "SHELLY_SWITCH",
  // Mammotion-Maeher: Befehl ueber den Maeher-Dienst des Hubs (payload: mower, action, planId).
  "MOWER_ACTION",
];

/**
 * GET (Hub, Token-Auth): holt offene Tasks ab und markiert sie als RUNNING.
 * Augenblicksgebundene Schaltbefehle, die laenger als eine Minute liegen
 * (expiredSwitchCommandsWhere; Ausschalten verfaellt nicht), werden vorher auf FAILED ("abgelaufen") gesetzt.
 * Steuerbefehle kommen in Anlege-Reihenfolge vor SCAN_SNAPSHOT.
 * GET (Session): listet die letzten Tasks fuer die UI. USER sieht nur die
 * Typen, die er selbst anlegen darf (hubTaskListFilter).
 */
export async function GET(request: NextRequest) {
  if (hasApiToken(request)) {
    const auth = await validateApiToken(request);
    if ("error" in auth) return auth.error;
    const { db, account } = auth;

    const now = new Date();
    await db.hubTask.updateMany({
      where: expiredSwitchCommandsWhere(account.id, now),
      data: { status: "FAILED", error: EXPIRED_TASK_ERROR, finishedAt: now },
    });

    const control = await db.hubTask.findMany({
      where: { accountId: account.id, status: "PENDING", type: { not: SCAN_SNAPSHOT_TYPE } },
      orderBy: { createdAt: "asc" },
      take: PICKUP_LIMIT,
    });
    const snapshots =
      control.length < PICKUP_LIMIT
        ? await db.hubTask.findMany({
            where: { accountId: account.id, status: "PENDING", type: SCAN_SNAPSHOT_TYPE },
            orderBy: { createdAt: "asc" },
            take: PICKUP_LIMIT - control.length,
          })
        : [];
    const pending = [...control, ...snapshots];
    if (pending.length > 0) {
      await db.hubTask.updateMany({
        where: { id: { in: pending.map((t) => t.id) } },
        data: { status: "RUNNING", startedAt: new Date() },
      });
    }
    return NextResponse.json(pending);
  }

  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const tasks = await session.db.hubTask.findMany({
    where: {
      accountId: session.accountId!,
      ...hubTaskListFilter(isTenantAdminRole(session.session.user.role)),
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json(tasks);
}

/** POST (Session-Auth): legt einen neuen Task fuer den Hub an. */
export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;
  if (accountId == null) {
    return NextResponse.json({ error: "Kein Mandant gewählt" }, { status: 400 });
  }

  const body = await request.json();
  if (!VALID_TASK_TYPES.includes(body.type)) {
    return NextResponse.json({ error: "Ungültiger Task-Typ" }, { status: 400 });
  }
  // USER darf nur bedienen (Schnappschuss, Tuer oeffnen); alle anderen
  // Auftraege an den Hub verlangen eine Verwaltungs-Rolle.
  if (!hubTaskAllowedForUser(body.type)) {
    const denied = adminRoleRequired(session.session.user.role);
    if (denied) return denied;
  }

  const check = checkHubTaskPayload(body.type, body.payload);
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 400 });
  }
  let cameraName: string | null = null;
  let holdPlan: DoorHoldTaskPlan | null = null;
  if (check.cameraId != null) {
    const camera = await db.camera.findFirst({
      where: { id: check.cameraId, accountId },
      select: { id: true, name: true, kind: true, enabled: true, doorHoldUntil: true, liveMode: true },
    });
    if (!camera) return NextResponse.json({ error: "Kamera nicht gefunden" }, { status: 400 });
    // Livebild und Vorschau „nur auf Tippen“ oder „aus“: kein Bild beim Hub anfordern.
    if (body.type === "CAMERA_SNAPSHOT" && !previewAllowed(camera.liveMode)) {
      return NextResponse.json({ error: PREVIEW_BLOCKED_ERROR }, { status: 400 });
    }
    cameraName = camera.name;
    if (body.type === "DOORBIRD_HOLD") holdPlan = doorHoldTaskPlan(camera, body.payload);
  }
  if (holdPlan?.action === "ablehnen") {
    return NextResponse.json({ error: holdPlan.error }, { status: 400 });
  }
  // Tor offen halten: Zielzustand wie /api/cameras/[id]/door-hold vor dem
  // Auftrag setzen. Der Hub liest ihn aus der Antwort auf jede Impuls-Meldung
  // und beendet ein Offenhalten, das dort nicht steht. Scheitert ein Start,
  // setzt die Ergebnis-Route den Zielzustand davor zurueck (doorHoldRevert).
  if (holdPlan?.action === "setzen" && check.cameraId != null) {
    await db.camera.update({
      where: { id: check.cameraId },
      data: holdPlan.until
        ? { doorHoldUntil: holdPlan.until, doorHoldPulseAt: null, doorHoldError: null }
        : { doorHoldUntil: null, doorHoldError: null },
      select: { id: true },
    });
  }

  const by = hubTaskActor(session.session.user);
  const payload = holdPlan ? doorHoldTaskPayload(check.payload, holdPlan) : check.payload;
  const task = await db.hubTask.create({
    data: {
      type: body.type,
      payload: withActor(payload, by) as object,
      accountId,
    },
  });
  // Kamera-Tueren haben keine Device-Zeile: deviceId 0, Kamera im Namen.
  // DOORBIRD_HOLD ohne payload.until (kein nicht-leerer Text) beendet das
  // Offenhalten – genau wie der Hub es liest.
  const rawUntil = (body.payload as { until?: unknown } | null | undefined)?.until;
  const holdEnds = body.type === "DOORBIRD_HOLD" && !(typeof rawUntil === "string" && rawUntil);
  const doorAction = holdEnds ? "doorbird_hold_ende" : LOGGED_DOOR_TASKS[body.type];
  if (doorAction && check.cameraId != null) {
    recordDeviceAction({
      accountId,
      deviceId: 0,
      deviceName: `${cameraName ?? "Kamera"} (Kamera ${check.cameraId})`,
      action: doorAction,
      result: "ok",
      by: { source: "admin", actorId: by.adminId },
    });
  }
  return NextResponse.json(task, { status: 201 });
}
