import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { waitForHubTask } from "@/lib/hub-task-wait";
import { formatControlValue, soundwebOnline, soundwebSetPayload } from "@/lib/soundweb";
import { hubOnline } from "@/lib/soundweb-server";

/**
 * Ein Regler bedienen: Fader auf eine Position schieben, den Hub warten
 * lassen, bis der Prozessor den Wert bestätigt hat, und antworten. Länger als
 * zehn Sekunden wartet niemand an einem Fader – dann gilt der Hub als weg.
 */
const SET_WAIT_MS = 10_000;

/**
 * POST { value }: GAIN in dB, MUTE als true/false, PERCENT 0–100, SELECT als
 * Auswahlwert; PRESET ohne Wert. Antwort: { ok, value (Rohwert), display }.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const { id } = await params;
  const controlId = Number(id);
  if (!Number.isInteger(controlId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const control = await db.soundwebControl.findFirst({
    where: { id: controlId, accountId: accountId! },
    include: { device: { select: { id: true, name: true, isActive: true, connected: true, lastSeenAt: true, lastError: true } } },
  });
  if (!control) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  if (!control.device.isActive) {
    return NextResponse.json({ error: `${control.device.name} ist deaktiviert` }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as { value?: unknown };
  const payload = soundwebSetPayload(control, body.value);
  if ("error" in payload) return NextResponse.json({ error: payload.error }, { status: 400 });

  // Ohne Hub bleibt jeder Task liegen; das sagen wir lieber sofort.
  if (!(await hubOnline(db, accountId!))) {
    return NextResponse.json(
      { error: "Der lokale Hub meldet sich nicht – Befehl kommt nicht an." },
      { status: 503 }
    );
  }
  if (!soundwebOnline(control.device)) {
    const reason = control.device.lastError ? `: ${control.device.lastError}` : "";
    return NextResponse.json(
      { error: `${control.device.name} ist nicht verbunden${reason}` },
      { status: 503 }
    );
  }

  const task = await db.hubTask.create({
    data: {
      type: "SOUNDWEB_SET",
      payload: {
        controlId: control.id,
        deviceId: control.deviceId,
        ...("raw" in payload ? { raw: payload.raw } : {}),
        ...("percent" in payload ? { percent: payload.percent } : {}),
        ...("preset" in payload ? { presetId: control.presetId } : {}),
      },
      accountId: accountId!,
    },
  });

  const outcome = await waitForHubTask(db, task.id, SET_WAIT_MS);
  if (outcome.status === "FAILED") {
    return NextResponse.json({ ok: false, taskId: task.id, error: outcome.error }, { status: 502 });
  }
  if (outcome.status === "PENDING") {
    return NextResponse.json(
      { ok: false, taskId: task.id, pending: true, error: "Hub hat nicht rechtzeitig geantwortet" },
      { status: 504 }
    );
  }

  const result = (outcome.result ?? {}) as { value?: unknown; presetId?: unknown };
  if (control.kind === "PRESET") {
    return NextResponse.json({ ok: true, taskId: task.id, presetId: result.presetId ?? control.presetId });
  }

  const value = Number(result.value);
  if (Number.isInteger(value)) {
    await db.soundwebControl.update({
      where: { id: control.id },
      data: { value, valueAt: new Date() },
    });
  }
  return NextResponse.json({
    ok: true,
    taskId: task.id,
    value: Number.isInteger(value) ? value : null,
    display: Number.isInteger(value) ? formatControlValue(control, value) : null,
  });
}
