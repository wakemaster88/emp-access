import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { requireAuth } from "@/lib/auth";
import { doorbirdOpenDoor } from "@/lib/doorbird";
import { evaluateDoorOpen } from "@/lib/door-policy";
import { getLastRingAt } from "@/lib/event-bus";
import { logEvent } from "@/lib/audit";
import { empAccessPostJson } from "@/lib/emp-access-client";
import { scheduleDoorbirdOpenSnapshotPipeline } from "@/lib/doorbird-event-followup";

export const dynamic = "force-dynamic";

/**
 * Sidecar-Aufruf: Fahrzeug steht in der Ausfahrt-Zone.
 * Öffnet DoorBird und/oder emp-access-Geräte laut Cam-Config.
 */
export async function POST(req: Request) {
  const denied = await requireAuth(req);
  if (denied) return denied;

  let camId = "";
  try {
    const body = (await req.json()) as { camId?: unknown };
    if (typeof body.camId === "string") camId = body.camId.trim();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!camId) {
    return NextResponse.json({ error: "camId fehlt" }, { status: 400 });
  }

  const config = await loadConfig();
  const cam = config.cams.find((c) => c.id === camId);
  if (!cam) return NextResponse.json({ error: "cam not found" }, { status: 404 });
  if (!cam.vehicleGate.enabled) {
    return NextResponse.json({ error: "vehicleGate deaktiviert" }, { status: 400 });
  }

  const results: {
    doorbird: boolean;
    devices: Array<{ id: number; ok: boolean; error?: string }>;
  } = { doorbird: false, devices: [] };

  if (cam.vehicleGate.openDoorbird) {
    if (!config.doorbird.enabled || !config.doorbird.ip) {
      await logEvent({
        action: "vehicle-gate-open",
        ok: false,
        meta: { camId, reason: "doorbird not configured" },
      });
      return NextResponse.json({ error: "doorbird not configured" }, { status: 400 });
    }
    const decision = evaluateDoorOpen({
      enforceRingWindow: config.doorbird.enforceRingWindow,
      source: "vehicle-gate",
      lastRingAt: getLastRingAt(),
      now: Date.now(),
      ringWindowSec: config.doorbird.ringWindowSec,
    });
    if (!decision.allowed) {
      await logEvent({
        action: "vehicle-gate-open",
        ok: false,
        meta: { camId, reason: decision.reason },
      });
      return NextResponse.json({ error: decision.reason }, { status: 403 });
    }
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 5000);
      await doorbirdOpenDoor(config.doorbird, ctl.signal);
      clearTimeout(t);
      results.doorbird = true;
      scheduleDoorbirdOpenSnapshotPipeline({
        source: "vehicle-gate",
        inRingWindow: decision.inWindow,
        elapsedSinceRingMs: decision.elapsedMs,
      });
    } catch (err) {
      const e = err as Error;
      await logEvent({
        action: "vehicle-gate-open",
        ok: false,
        meta: { camId, error: e.message },
      });
      return NextResponse.json({ error: e.message }, { status: 502 });
    }
  }

  const emp = config.settings.empAccess;
  if (cam.vehicleGate.deviceIds.length > 0) {
    if (!emp.enabled || !emp.apiToken.trim()) {
      results.devices = cam.vehicleGate.deviceIds.map((id) => ({
        id,
        ok: false,
        error: "emp-access nicht konfiguriert",
      }));
    } else {
      for (const id of cam.vehicleGate.deviceIds) {
        try {
          await empAccessPostJson(
            emp.baseUrl,
            emp.apiToken,
            `/api/devices/${id}/action`,
            { action: "open" },
          );
          results.devices.push({ id, ok: true });
        } catch (err) {
          const e = err as Error;
          results.devices.push({ id, ok: false, error: e.message });
        }
      }
    }
  }

  const deviceFailed = results.devices.some((d) => !d.ok);
  await logEvent({
    action: "vehicle-gate-open",
    ok: results.doorbird || (results.devices.length > 0 && !deviceFailed),
    meta: { camId, ...results },
  });
  return NextResponse.json({ ok: true, ...results });
}
