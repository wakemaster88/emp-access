import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import type { TenantDb } from "@/lib/prisma";
import { waitForHubTask } from "@/lib/hub-task-wait";
import {
  DOOR_HOLD_MAX_MINUTES,
  doorHoldState,
  parseDoorHoldMinutes,
} from "@/lib/door-hold";

/**
 * Tor offen halten (DoorBird):
 *   GET    → aktueller Zustand
 *   POST   { minutes } → Offenhaltung starten oder verlaengern
 *   DELETE → Offenhaltung beenden
 *
 * Die Cloud setzt Camera.doorHoldUntil (Zielzustand) und legt einen
 * DOORBIRD_HOLD-Task an, damit der Hub sofort reagiert. Der Hub loest das
 * Relais dann im Takt aus (das Tor schliesst sonst nach ~1 min) und meldet
 * jeden Impuls an /api/hub/cameras/[id]/door-hold zurueck. Nach einem
 * Hub-Neustart nimmt er eine laufende Offenhaltung aus der Kamera-
 * Konfiguration (/api/hub/cameras) wieder auf.
 */

const HOLD_SELECT = {
  id: true,
  name: true,
  kind: true,
  enabled: true,
  doorHoldUntil: true,
  doorHoldPulseAt: true,
  doorHoldError: true,
} as const;

type Ctx = { db: TenantDb; accountId: number; cameraId: number };

async function context(params: Promise<{ id: string }>): Promise<{ error: NextResponse } | Ctx> {
  const session = await getSessionWithDb();
  if ("error" in session) {
    return { error: session.error ?? NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }
  const { id } = await params;
  const cameraId = Number(id);
  if (!Number.isInteger(cameraId)) {
    return { error: NextResponse.json({ error: "Ungültige ID" }, { status: 400 }) };
  }
  return { db: session.db, accountId: session.accountId!, cameraId };
}

function loadCamera(ctx: Ctx) {
  return ctx.db.camera.findFirst({
    where: { id: ctx.cameraId, accountId: ctx.accountId },
    select: HOLD_SELECT,
  });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await context(params);
  if ("error" in ctx) return ctx.error;
  const camera = await loadCamera(ctx);
  if (!camera) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  return NextResponse.json({ ok: true, hold: doorHoldState(camera) });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await context(params);
  if ("error" in ctx) return ctx.error;
  const { db, accountId } = ctx;
  const camera = await loadCamera(ctx);
  if (!camera) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  if (camera.kind !== "DOORBIRD") {
    return NextResponse.json(
      { error: "Offen halten gibt es nur für DoorBird-Türstationen" },
      { status: 400 }
    );
  }
  if (!camera.enabled) {
    return NextResponse.json({ error: "Kamera ist deaktiviert" }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const minutes = parseDoorHoldMinutes(body.minutes);
  if (minutes === null) {
    return NextResponse.json(
      { error: `Dauer muss zwischen 1 und ${DOOR_HOLD_MAX_MINUTES} Minuten liegen` },
      { status: 400 }
    );
  }

  const until = new Date(Date.now() + minutes * 60_000);
  const previousUntil = camera.doorHoldUntil;
  await db.camera.update({
    where: { id: camera.id },
    data: { doorHoldUntil: until, doorHoldPulseAt: null, doorHoldError: null },
    select: { id: true },
  });
  const task = await db.hubTask.create({
    data: {
      type: "DOORBIRD_HOLD",
      payload: { cameraId: camera.id, until: until.toISOString(), relay: 1 },
      accountId,
    },
    select: { id: true },
  });

  const outcome = await waitForHubTask(db, task.id);
  if (outcome.status === "FAILED") {
    // Hub kennt die DoorBird nicht o. ae.: Zielzustand zuruecknehmen, sonst
    // zeigt die UI "aktiv", obwohl nichts pulst.
    await db.camera.update({
      where: { id: camera.id },
      data: { doorHoldUntil: previousUntil, doorHoldError: outcome.error },
      select: { id: true },
    });
    return NextResponse.json({ ok: false, taskId: task.id, error: outcome.error }, { status: 502 });
  }

  const fresh = (await loadCamera(ctx)) ?? camera;
  return NextResponse.json({
    ok: true,
    taskId: task.id,
    // Hub hat (noch) nicht geantwortet: Zielzustand steht, der Hub holt den
    // Task nach – die UI zeigt "aktiv" mit Hinweis, bis der erste Impuls kommt.
    pending: outcome.status === "PENDING",
    hold: doorHoldState(fresh),
    result: outcome.status === "DONE" ? outcome.result : undefined,
  });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await context(params);
  if ("error" in ctx) return ctx.error;
  const { db, accountId } = ctx;
  const camera = await loadCamera(ctx);
  if (!camera) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  // Zielzustand zuerst loeschen – selbst wenn der Hub gerade offline ist,
  // pulst er nach dem naechsten Task/Konfig-Abruf nicht weiter.
  await db.camera.update({
    where: { id: camera.id },
    data: { doorHoldUntil: null, doorHoldError: null },
    select: { id: true },
  });
  const task = await db.hubTask.create({
    data: {
      type: "DOORBIRD_HOLD",
      payload: { cameraId: camera.id, until: null },
      accountId,
    },
    select: { id: true },
  });

  const outcome = await waitForHubTask(db, task.id);
  const fresh = (await loadCamera(ctx)) ?? camera;
  return NextResponse.json({
    ok: outcome.status !== "FAILED",
    taskId: task.id,
    pending: outcome.status === "PENDING",
    error: outcome.status === "FAILED" ? outcome.error : undefined,
    hold: doorHoldState(fresh),
  });
}
