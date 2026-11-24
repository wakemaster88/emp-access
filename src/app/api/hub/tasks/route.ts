import { NextRequest, NextResponse } from "next/server";
import { adminRoleRequired, getSessionWithDb, isTenantAdminRole, validateApiToken } from "@/lib/api-auth";
import { hubTaskAllowedForUser, hubTaskListFilter } from "@/lib/role-guards";

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
 * GET (Session): listet die letzten Tasks fuer die UI. USER sieht nur die
 * Typen, die er selbst anlegen darf (hubTaskListFilter).
 */
export async function GET(request: NextRequest) {
  if (hasApiToken(request)) {
    const auth = await validateApiToken(request);
    if ("error" in auth) return auth.error;
    const { db, account } = auth;

    const pending = await db.hubTask.findMany({
      where: { accountId: account.id, status: "PENDING" },
      orderBy: { createdAt: "asc" },
      take: 10,
    });
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

  const task = await db.hubTask.create({
    data: {
      type: body.type,
      payload: body.payload ?? undefined,
      accountId: accountId!,
    },
  });
  return NextResponse.json(task, { status: 201 });
}
