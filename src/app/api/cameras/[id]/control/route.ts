import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

/**
 * Kamera-Steuerung (Kontrollzentrum): legt einen Hub-Task an und wartet
 * kurz auf das Ergebnis. Der Hub pollt Tasks alle ~5 s, daher warten wir
 * bis zu 15 s bevor wir mit "pending" antworten.
 */

const ACTION_TO_TASK: Record<string, string> = {
  ptz: "CAMERA_PTZ",
  spotlight: "CAMERA_SPOTLIGHT",
  ir: "CAMERA_IR",
  siren: "CAMERA_SIREN",
  presets: "CAMERA_PTZ_PRESETS",
  snapshot: "CAMERA_SNAPSHOT",
};

const WAIT_TIMEOUT_MS = 15_000;
const WAIT_POLL_MS = 750;

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
  if (camera.kind !== "REOLINK") {
    return NextResponse.json(
      { error: "Steuerung wird nur für Reolink-Kameras unterstützt" },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const action = String(body.action ?? "");
  const taskType = ACTION_TO_TASK[action];
  if (!taskType) {
    return NextResponse.json(
      { error: `Ungültige Aktion (${Object.keys(ACTION_TO_TASK).join(", ")})` },
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

  // Auf das Hub-Ergebnis warten (kurzes DB-Polling).
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, WAIT_POLL_MS));
    const current = await db.hubTask.findUnique({
      where: { id: task.id },
      select: { status: true, result: true, error: true },
    });
    if (!current) break;
    if (current.status === "DONE") {
      return NextResponse.json({ ok: true, taskId: task.id, result: current.result });
    }
    if (current.status === "FAILED") {
      return NextResponse.json(
        { ok: false, taskId: task.id, error: current.error ?? "Task fehlgeschlagen" },
        { status: 502 }
      );
    }
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
