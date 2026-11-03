import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";
import { isValidDeviceAction } from "@/lib/device-open";
import { runDeviceSwitchedRules } from "@/lib/room-rules";

const TASK: Record<string, number> = { open: 1, emergency: 2, deactivate: 3, reset: 0, close: 3, stop: 0 };

/**
 * POST (Hub): Der Hub hat ein Geraet selbst im LAN geschaltet. Haelt den
 * Task-Stand wie bei einem Cloud-Befehl nach und startet die Regeln
 * "Geraet geschaltet" – sonst bekaeme die Cloud lokale Schaltvorgaenge nie mit.
 * Body: { deviceId, action }
 */
export async function POST(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const { db, account } = auth;
  const body = await request.json().catch(() => ({}));
  const deviceId = Number(body.deviceId);
  const action = String(body.action ?? "");
  if (!Number.isInteger(deviceId) || !isValidDeviceAction(action)) {
    return NextResponse.json({ error: "Ungültige Angaben" }, { status: 400 });
  }
  const device = await db.device.findFirst({ where: { id: deviceId, accountId: account.id }, select: { id: true } });
  if (!device) return NextResponse.json({ error: "Gerät nicht gefunden" }, { status: 404 });
  await db.device.update({ where: { id: deviceId }, data: { task: TASK[action] ?? 0 } });
  const { triggered } = await runDeviceSwitchedRules(account.id, deviceId, action);
  return NextResponse.json({ ok: true, triggered });
}
