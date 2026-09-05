import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { deviceTokenMismatch, validateApiToken } from "@/lib/api-auth";
import { piStatusSchema } from "@/lib/validators";
import { LATEST_PI_VERSION } from "@/lib/pi-version";

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
} as const;

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
  const device = await db.device.findFirst({
    where: { id: Number(piId), type: "RASPBERRY_PI" },
    select: PI_STATE_SELECT,
  });

  if (!device) {
    return NextResponse.json({ error: "Device not found" }, { status: 404 });
  }

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
    const current = await db.device.findFirst({
      where: { id: update.pis_id, type: "RASPBERRY_PI" },
      select: PI_STATE_SELECT,
    });
    if (!current) {
      results.push({ pis_id: update.pis_id, updated: false });
      continue;
    }

    const data: Record<string, unknown> = {
      lastUpdate: new Date(update.pis_update * 1000),
    };
    if (update.system_info) {
      data.systemInfo = update.system_info;
    }
    // Task nur zuruecksetzen, wenn Server task=1 (Einmal-Oeffnen) gesetzt
    // hatte und der Pi bestaetigt (pis_task: 0). Alle anderen Faelle:
    // Task bleibt unveraendert; nur lastUpdate/systemInfo wird gesetzt.
    const resetTask = current.task === 1 && update.pis_task === 0;
    if (resetTask) {
      data.task = 0;
    }

    // 1 Write: state-Update, ohne anschliessenden Re-Read. Wir kennen die
    // Felder bereits aus `current` und mergen das ggf. zurueckgesetzte Task.
    const updated = await db.device.updateMany({
      where: { id: update.pis_id, type: "RASPBERRY_PI" },
      data,
    });
    if (updated.count === 0) {
      results.push({ pis_id: update.pis_id, updated: false });
      continue;
    }

    const merged: PiStateFields = resetTask ? { ...current, task: 0 } : current;
    results.push({ ...deviceToPiState(merged), updated: true });
  }

  return NextResponse.json({
    latest_scanner_version: LATEST_PI_VERSION,
    results,
  });
}
