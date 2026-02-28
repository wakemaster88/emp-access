import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb, validateApiToken } from "@/lib/api-auth";

// Task codes for Raspberry Pi
// 0 = idle, 1 = open once, 2 = emergency open (NOT-AUF), 3 = deactivate

// Shelly Cloud uses 1-based channel suffixes (_1 = switch 0). Map to 0-based switch index.
function toSwitchIndex(shellyId: string | null): number {
  if (!shellyId?.includes("_")) return 0;
  const suffix = Number(shellyId.split("_").pop());
  return isNaN(suffix) || suffix === 0 ? 0 : suffix - 1;
}

async function shellySendLocal(ip: string, switchIdx: number, turnOn: boolean, timerSec?: number): Promise<boolean> {
  const onStr = turnOn ? "true" : "false";
  const turnStr = turnOn ? "on" : "off";

  // Gen2: POST /rpc/Switch.Set
  try {
    const body: Record<string, unknown> = { id: switchIdx, on: turnOn };
    if (timerSec) body.toggle_after = timerSec;
    const res = await fetch(`http://${ip}/rpc/Switch.Set`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) return true;
  } catch { /* try Gen2 GET */ }

  // Gen2 GET fallback
  try {
    const params = new URLSearchParams({ id: String(switchIdx), on: onStr });
    if (timerSec) params.set("toggle_after", String(timerSec));
    const res = await fetch(`http://${ip}/rpc/Switch.Set?${params}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) return true;
  } catch { /* try Gen1 */ }

  // Gen1: /relay/{idx}?turn=on/off
  try {
    let url = `http://${ip}/relay/${switchIdx}?turn=${turnStr}`;
    if (timerSec) url += `&timer=${timerSec}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (res.ok) return true;
  } catch { /* unavailable */ }

  return false;
}

async function shellySendCloud(baseUrl: string, authKey: string, shellyBaseId: string, switchIdx: number, turnOn: boolean): Promise<boolean> {
  try {
    const body = new URLSearchParams({
      auth_key: authKey.trim(),
      id: shellyBaseId,
      channel: String(switchIdx),
      turn: turnOn ? "on" : "off",
    });
    const res = await fetch(`${baseUrl}/device/relay/control`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json() as { isok?: boolean };
      return data.isok === true;
    }
  } catch { /* unavailable */ }
  return false;
}

function hasApiToken(request: NextRequest) {
  return request.nextUrl.searchParams.has("token") || request.headers.has("authorization");
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let db, accountId: number;
  if (hasApiToken(request)) {
    const auth = await validateApiToken(request);
    if ("error" in auth) return auth.error;
    db = auth.db;
    accountId = auth.account.id;
  } else {
    const session = await getSessionWithDb();
    if ("error" in session) return session.error;
    db = session.db;
    accountId = session.accountId!;
  }

  const { id } = await params;
  const deviceId = Number(id);
  if (isNaN(deviceId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const body = await request.json();
  const action = body.action as string;

  const taskMap: Record<string, number> = {
    open: 1,
    emergency: 2,
    deactivate: 3,
    reset: 0,
  };

  if (!(action in taskMap)) {
    return NextResponse.json({ error: "Ungültige Aktion" }, { status: 400 });
  }

  const existing = await db.device.findFirst({
    where: { id: deviceId, accountId: accountId! },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const device = await db.device.update({
    where: { id: deviceId },
    data: { task: taskMap[action] },
  });

  // For Shelly devices: send switch command via local API (Gen2 + Gen1) or Cloud fallback
  if (existing.type === "SHELLY") {
    const turnOn = action === "open" || action === "emergency";
    const timerSec = action === "open" ? 3 : undefined;
    const switchIdx = toSwitchIndex(existing.shellyId);

    let sent = false;

    // 1. Try local IP
    if (existing.ipAddress) {
      sent = await shellySendLocal(existing.ipAddress, switchIdx, turnOn, timerSec);
    }

    // 2. Fallback: Shelly Cloud control
    if (!sent) {
      const shellyBaseId = existing.shellyId?.split("_")[0] ?? existing.shellyId;
      const config = await db.apiConfig.findFirst({
        where: { accountId: accountId!, provider: "SHELLY" },
      });
      if (config?.token && config?.baseUrl && shellyBaseId) {
        const cloudBaseUrl = `https://${config.baseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
        sent = await shellySendCloud(cloudBaseUrl, config.token, shellyBaseId, switchIdx, turnOn);
      }
    }

    return NextResponse.json({ ok: true, task: device.task, sent });
  }

  return NextResponse.json({ ok: true, task: device.task });
}
