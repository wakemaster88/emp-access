import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { isMowerAction, readMowerState } from "@/lib/mower";

/**
 * POST (Session): Befehl an einen Mammotion-Maeher.
 *
 * Die Cloud erreicht den Maeher nicht selbst; sie legt einen Hub-Task
 * `MOWER_ACTION` an, den der Hub binnen Sekunden abholt und ueber seinen
 * Maeher-Dienst ausfuehrt.
 *
 * Body: { action: "start_task" | "pause" | "resume" | "stop" | "dock", planId? }
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;
  if (!accountId) return NextResponse.json({ error: "Kein Mandant" }, { status: 403 });

  const { id } = await params;
  const deviceId = Number(id);
  if (!Number.isInteger(deviceId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const action = body.action;
  if (!isMowerAction(action)) return NextResponse.json({ error: "Ungültige Aktion" }, { status: 400 });

  const device = await db.device.findFirst({
    where: { id: deviceId, accountId, type: "MAMMOTION_MOWER" },
    select: { id: true, name: true, mowerName: true, systemInfo: true },
  });
  if (!device?.mowerName) return NextResponse.json({ error: "Mäher nicht gefunden" }, { status: 404 });

  let planId: string | undefined;
  if (action === "start_task") {
    planId = typeof body.planId === "string" ? body.planId.trim() : "";
    const state = readMowerState(device.systemInfo);
    if (!planId || !state?.tasks.some((t) => t.id === planId)) {
      return NextResponse.json({ error: "Aufgabe unbekannt" }, { status: 400 });
    }
  }

  const task = await db.hubTask.create({
    data: {
      accountId,
      type: "MOWER_ACTION",
      payload: { deviceId: device.id, mower: device.mowerName, action, ...(planId ? { planId } : {}) },
    },
    select: { id: true },
  });
  return NextResponse.json({ ok: true, taskId: task.id });
}
