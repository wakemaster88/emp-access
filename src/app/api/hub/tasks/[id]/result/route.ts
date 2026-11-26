import { after, NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-token-auth";
import { ingestHubScanDevices } from "@/lib/network-scan-ingest";
import { queueFaceAnalysis } from "@/lib/unknown-persons";
import { runDeviceSwitchedRules, settleHubHandovers } from "@/lib/room-rules";
import { switchedFollowUp } from "@/lib/rule-run-rules";
import { doorHoldRevert } from "@/lib/door-hold";

/** Auftraege, die eine Raumregel an den Hub uebergibt (Hue, Kamera steuern). */
const RULE_TASK_TYPES = new Set(["HUE_SET", "CAMERA_SCENE"]);

/** Hub meldet das Ergebnis eines Tasks zurueck (Token-Auth). */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const { db, account } = auth;

  const { id } = await params;
  const taskId = Number(id);
  if (isNaN(taskId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const task = await db.hubTask.findFirst({
    where: { id: taskId, accountId: account.id },
  });
  if (!task) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const success = body.success !== false;

  // Aeltere Hub-Versionen liefern bei NETWORK_SCAN nur ARP-Listen im Task-Result
  // (ohne /api/hub/scan-Upload) – diese hier nachziehen.
  let ingest: { processed: number; synced: number } | null = null;
  if (success && task.type === "NETWORK_SCAN") {
    const result = body.result as { devices?: unknown[] } | null;
    if (Array.isArray(result?.devices) && result.devices.length > 0) {
      const hub = await db.hubAgent.findFirst({
        where: { accountId: account.id },
        orderBy: { lastSeenAt: "desc" },
        select: { name: true },
      });
      ingest = await ingestHubScanDevices(
        db,
        account.id,
        result.devices,
        hub?.name ?? null
      );
    }
  }

  const updated = await db.hubTask.update({
    where: { id: taskId },
    data: {
      status: success ? "DONE" : "FAILED",
      result: body.result ?? undefined,
      error: success ? null : (body.error || "Unbekannter Fehler"),
      finishedAt: new Date(),
    },
  });
  // Tor offen halten aus POST /api/hub/tasks gescheitert (der Hub kennt die
  // DoorBird nicht): Zielzustand zuruecknehmen, sonst begaenne das Offenhalten
  // spaeter ohne neuen Befehl, sobald der Hub die DoorBird kennt. Nur solange
  // kein neuerer Auftrag ihn geaendert hat.
  const holdRevert = doorHoldRevert(task, success);
  if (holdRevert) {
    await db.camera.updateMany({
      where: { id: holdRevert.cameraId, accountId: account.id, doorHoldUntil: holdRevert.until },
      data: { doorHoldUntil: holdRevert.before, doorHoldError: updated.error },
    });
  }
  // Von einer Raumregel uebergeben: Ergebnis im Regel-Verlauf nachtragen.
  const ruleId = Number((task.payload as { ruleId?: unknown } | null)?.ruleId);
  if (RULE_TASK_TYPES.has(task.type) && Number.isInteger(ruleId) && ruleId > 0) {
    await settleHubHandovers(account.id, { hubTaskId: taskId, ruleId }).catch((e) => {
      console.error(`[hub/tasks] Regel-Verlauf fuer Auftrag ${taskId} nicht nachgetragen:`, (e as Error).message);
    });
  }

  // Hue geschaltet: Regeln „Geraet geschaltet“ jetzt, nicht schon bei der
  // Uebergabe. Nach der Antwort, aber verlaesslich zu Ende (after).
  const followUp = switchedFollowUp(
    task,
    { success, wasOpen: task.status !== "DONE" && task.status !== "FAILED" },
    new Date(),
  );
  if (followUp) {
    after(() =>
      runDeviceSwitchedRules(account.id, followUp.deviceId, followUp.action, followUp.depth).catch((e) => {
        console.error(`[hub/tasks] Folgeregeln fuer Auftrag ${taskId} fehlgeschlagen:`, (e as Error).message);
      }),
    );
  }

  // Gesichts-Analyse alter Sichtungen: naechsten Stapel gleich nachschieben,
  // bis der Rueckstand abgearbeitet ist (stoppt, wenn nichts mehr analysiert wurde).
  let nextAnalyze: { queued: number; taskId: number | null } | null = null;
  if (success && task.type === "FACE_ANALYZE") {
    const analyzed = Number((body.result as { analyzed?: unknown } | null)?.analyzed ?? 0);
    if (analyzed > 0) nextAnalyze = await queueFaceAnalysis(account.id);
  }

  return NextResponse.json({ ...updated, ingest, nextAnalyze });
}
