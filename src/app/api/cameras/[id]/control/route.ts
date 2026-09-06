import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { waitForHubTask } from "@/lib/hub-task-wait";

/**
 * Kamera-Steuerung (Kontrollzentrum): legt einen Hub-Task an und wartet
 * kurz auf das Ergebnis (waitForHubTask: bis zu 15 s, sonst "pending").
 */

const ACTION_TO_TASK: Record<string, string> = {
  ptz: "CAMERA_PTZ",
  spotlight: "CAMERA_SPOTLIGHT",
  ir: "CAMERA_IR",
  siren: "CAMERA_SIREN",
  presets: "CAMERA_PTZ_PRESETS",
  snapshot: "CAMERA_SNAPSHOT",
  door: "DOORBIRD_OPEN",
};

/** Erlaubte Aktionen je Geraetetyp. */
const ACTIONS_BY_KIND: Record<string, string[]> = {
  REOLINK: ["ptz", "spotlight", "ir", "siren", "presets", "snapshot"],
  DOORBIRD: ["door", "snapshot"],
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const { id } = await params;
  const cameraId = Number(id);
  if (isNaN(cameraId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const camera = await db.camera.findFirst({
    where: { id: cameraId, accountId: accountId! },
    select: { id: true, kind: true, enabled: true },
  });
  if (!camera) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  if (!camera.enabled) {
    return NextResponse.json({ error: "Kamera ist deaktiviert" }, { status: 400 });
  }
  const allowed = ACTIONS_BY_KIND[camera.kind];
  if (!allowed) {
    return NextResponse.json(
      { error: "Steuerung wird für diesen Gerätetyp nicht unterstützt" },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const action = String(body.action ?? "");
  const taskType = ACTION_TO_TASK[action];
  if (!taskType || !allowed.includes(action)) {
    return NextResponse.json(
      { error: `Ungültige Aktion für ${camera.kind} (${allowed.join(", ")})` },
      { status: 400 }
    );
  }

  const payload =
    body.payload && typeof body.payload === "object"
      ? (body.payload as Record<string, unknown>)
      : {};

  const task = await db.hubTask.create({
    data: {
      type: taskType,
      payload: { ...payload, cameraId },
      accountId: accountId!,
    },
  });

  const outcome = await waitForHubTask(db, task.id);
  if (outcome.status === "DONE") {
    return NextResponse.json({ ok: true, taskId: task.id, result: outcome.result });
  }
  if (outcome.status === "FAILED") {
    return NextResponse.json(
      { ok: false, taskId: task.id, error: outcome.error },
      { status: 502 }
    );
  }

  return NextResponse.json(
    {
      ok: false,
      taskId: task.id,
      pending: true,
      error: "Hub hat nicht rechtzeitig geantwortet (offline?)",
    },
    { status: 504 }
  );
}
