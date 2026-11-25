import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { deviceTokenMismatch, validateApiToken } from "@/lib/api-token-auth";
import { piStatusSchema } from "@/lib/validators";
import { LATEST_PI_VERSION } from "@/lib/pi-version";
import { piOpenTaskExpired, piOpenTaskNeedsFetchMark, piReportWrite } from "@/lib/hub-task-rules";
import type { TenantDb } from "@/lib/prisma";

type PiStateFields = {
  id: number;
  name: string;
  type: string;
  accessIn: number | null;
  accessOut: number | null;
  isActive: boolean;
  task: number;
  allowReentry: boolean;
  firmware: string | null;
};

/** Reduzierter Pi-State; Felder werden auch fuer die ETag-Berechnung genutzt. */
const PI_STATE_SELECT = {
  id: true,
  name: true,
  type: true,
  accessIn: true,
  accessOut: true,
  isActive: true,
  task: true,
  allowReentry: true,
  firmware: true,
  taskSetAt: true,
  taskFetchedSetAt: true,
} as const;

type OpenTaskFields = { id: number; task: number; taskSetAt: Date | null; taskFetchedSetAt: Date | null };

/**
 * Einmal-Oeffnen (task=1), das laenger als eine Minute auf den Pi wartet
 * (Pi stromlos oder offline), wird nicht mehr ausgeliefert, sondern auf 0
 * zurueckgesetzt. Ohne taskSetAt (alte Zeilen) bleibt alles wie bisher.
 */
async function dropExpiredOpenTask<T extends OpenTaskFields>(db: TenantDb, device: T): Promise<T> {
  if (!piOpenTaskExpired(device.task, device.taskSetAt)) return device;
  await db.device.updateMany({
    where: { id: device.id, type: "RASPBERRY_PI", task: 1, taskSetAt: device.taskSetAt },
    data: { task: 0, taskSetAt: null },
  });
  return { ...device, task: 0, taskSetAt: null };
}

/**
 * GET: verfallenes Einmal-Oeffnen zuruecksetzen, sonst ein noch nicht
 * vermerktes als abgeholt vermerken (es geht mit dieser Antwort an den Pi).
 * Hoechstens ein Schreibzugriff, und nur solange task=1 ansteht.
 */
async function settleOpenTaskForFetch<T extends OpenTaskFields>(db: TenantDb, found: T): Promise<T> {
  const device = await dropExpiredOpenTask(db, found);
  if (device !== found || !piOpenTaskNeedsFetchMark(device.task, device.taskSetAt, device.taskFetchedSetAt)) {
    return device;
  }
  await db.device.updateMany({
    where: { id: device.id, type: "RASPBERRY_PI", task: 1, taskSetAt: device.taskSetAt },
    data: { taskFetchedSetAt: device.taskSetAt },
  });
  return { ...device, taskFetchedSetAt: device.taskSetAt };
}

function deviceToPiState(device: PiStateFields) {
  return {
    pis_id: device.id,
    pis_name: device.name,
    pis_type: device.type,
    pis_in: device.accessIn,
    pis_out: device.accessOut,
    pis_active: device.isActive ? 1 : 0,
    pis_task: device.task,
    pis_again: device.allowReentry ? 1 : 0,
    pis_firmware: device.firmware,
  };
}

/** Stabiler Hash ueber den State, der dem Pi auf GET geliefert wird. */
function piStateEtag(device: PiStateFields): string {
  const payload = [
    device.id,
    device.name,
    device.type,
    device.accessIn,
    device.accessOut,
    device.isActive ? 1 : 0,
    device.task,
    device.allowReentry ? 1 : 0,
    device.firmware ?? "",
    LATEST_PI_VERSION,
  ].join("|");
  const hash = createHash("sha1").update(payload).digest("base64url").slice(0, 16);
  return `W/"${hash}"`;
}

function ifNoneMatchMatches(headerValue: string | null, etag: string): boolean {
  if (!headerValue) return false;
  // Liste mit ", " getrennt, Werte koennen weak ("W/") sein.
  return headerValue
    .split(",")
    .map((v) => v.trim())
    .some((v) => v === etag || v === etag.replace(/^W\//, "") || `W/${v}` === etag);
}

export async function GET(request: NextRequest) {
  const auth = await validateApiToken(request, { allowDevice: true });
  if ("error" in auth) return auth.error;

  const piId = request.nextUrl.searchParams.get("id");
  if (!piId) {
    return NextResponse.json({ error: "Missing id parameter" }, { status: 400 });
  }
  const mismatch = deviceTokenMismatch(auth, Number(piId));
  if (mismatch) return mismatch;

  const { db } = auth;
  const found = await db.device.findFirst({
    where: { id: Number(piId), type: "RASPBERRY_PI" },
    select: PI_STATE_SELECT,
  });

  if (!found) {
    return NextResponse.json({ error: "Device not found" }, { status: 404 });
  }
  const device = await settleOpenTaskForFetch(db, found);

  const etag = piStateEtag(device);
  const ifNoneMatch = request.headers.get("if-none-match");
  // Bei 304 keinen Body senden; ETag + Cache-Control wie beim 200 mitgeben,
  // damit Caches/Pis sich konsistent verhalten.
  const cacheHeaders = {
    ETag: etag,
    "Cache-Control": "private, max-age=2, must-revalidate",
  } as const;

  if (ifNoneMatchMatches(ifNoneMatch, etag)) {
    return new NextResponse(null, { status: 304, headers: cacheHeaders });
  }

  return NextResponse.json(
    {
      ...deviceToPiState(device),
      /** Soll-Version laut Server (Dashboard) – Pi: `emp_scanner.VERSION` nach `git pull` angleichen */
      latest_scanner_version: LATEST_PI_VERSION,
    },
    { headers: cacheHeaders },
  );
}

export async function POST(request: NextRequest) {
  const auth = await validateApiToken(request, { allowDevice: true });
  if ("error" in auth) return auth.error;

  const body = await request.json();
  const parsed = piStatusSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { db } = auth;
  const results: Array<
    | (ReturnType<typeof deviceToPiState> & { updated: true })
    | { pis_id: number; updated: false }
  > = [];

  for (const update of parsed.data) {
    // Ein Geraete-Token darf nur den eigenen Zustand melden.
    if (auth.device && auth.device.id !== update.pis_id) {
      results.push({ pis_id: update.pis_id, updated: false });
      continue;
    }
    // 1 Read: kompletter Pi-State + task fuer die "Task=1 → 0" Entscheidung.
    const found = await db.device.findFirst({
      where: { id: update.pis_id, type: "RASPBERRY_PI" },
      select: PI_STATE_SELECT,
    });
    if (!found) {
      results.push({ pis_id: update.pis_id, updated: false });
      continue;
    }
    const current = await dropExpiredOpenTask(db, found);

    const data: Record<string, unknown> = {
      lastUpdate: new Date(update.pis_update * 1000),
    };
    if (update.system_info) {
      data.systemInfo = update.system_info;
    }
    // Task nur zuruecksetzen, wenn Server task=1 (Einmal-Oeffnen) gesetzt
    // hatte, der Pi diesen Auftrag schon abgeholt hat und 0 meldet. Ein
    // danach gesetzter Auftrag bleibt stehen; die Antwort traegt dann 0 wie
    // bisher, ausgeliefert wird er nur per GET. Meldet der Pi etwas anderes
    // als 0, geht task=1 wie bisher mit der Antwort raus und wird im selben
    // Schreibzugriff als abgeholt vermerkt. Sonst: Task bleibt unveraendert;
    // nur lastUpdate/systemInfo wird gesetzt.
    const plan = piReportWrite(current.task, update.pis_task, current.taskSetAt, current.taskFetchedSetAt);

    // 1 Write: state-Update, ohne anschliessenden Re-Read. Wir kennen die
    // Felder bereits aus `current` und mergen das ggf. zurueckgesetzte Task.
    // Zuruecksetzen und Abhol-Vermerk gelten nur fuer den gelesenen Auftrag;
    // wurde inzwischen ein neuer gesetzt (oder der Task geaendert), bleibt er
    // unberuehrt und nur lastUpdate/systemInfo wird geschrieben.
    let updated = await db.device.updateMany({
      where: plan.guarded
        ? { id: update.pis_id, type: "RASPBERRY_PI", task: 1, taskSetAt: current.taskSetAt }
        : { id: update.pis_id, type: "RASPBERRY_PI" },
      data: { ...data, ...plan.data },
    });
    if (updated.count === 0 && plan.guarded) {
      updated = await db.device.updateMany({
        where: { id: update.pis_id, type: "RASPBERRY_PI" },
        data,
      });
    }
    if (updated.count === 0) {
      results.push({ pis_id: update.pis_id, updated: false });
      continue;
    }

    const merged: PiStateFields = plan.answerTask === current.task ? current : { ...current, task: plan.answerTask };
    results.push({ ...deviceToPiState(merged), updated: true });
  }

  return NextResponse.json({
    latest_scanner_version: LATEST_PI_VERSION,
    results,
  });
}
