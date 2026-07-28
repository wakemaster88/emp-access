import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { loqedGetLock } from "@/lib/loqed";
import { loqedBatteryType } from "@/lib/loqed-constants";
import type { Prisma } from "@prisma/client";

/**
 * POST /api/devices/[id]/loqed-refresh
 *
 * Holt Riegelzustand und Batterie frisch bei LOQED und schreibt sie in
 * `Device.systemInfo`.
 *
 * Bewusst nur auf Knopfdruck und nicht im Hintergrund: Der Zustand kommt
 * normalerweise vom Webhook, sobald sich am Schloss etwas bewegt. Regelmaessiges
 * Nachfragen waere nicht nur unnoetig, LOQED begrenzt es auch.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const { id } = await params;
  const deviceId = Number(id);
  if (Number.isNaN(deviceId)) {
    return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  }

  const device = await db.device.findFirst({
    where: { id: deviceId, accountId: accountId!, type: "LOQED_SMARTLOCK" },
  });
  if (!device) {
    return NextResponse.json({ error: "LOQED-Schloss nicht gefunden" }, { status: 404 });
  }
  if (!device.loqedLockId) {
    return NextResponse.json(
      { error: "Für dieses Schloss ist keine LOQED-Kennung hinterlegt – bitte abgleichen." },
      { status: 400 },
    );
  }

  const config = await db.apiConfig.findFirst({
    where: { accountId: accountId!, provider: "LOQED" },
  });
  if (!config?.token?.trim()) {
    return NextResponse.json({ error: "LOQED ist nicht eingerichtet." }, { status: 404 });
  }

  const { lock, error } = await loqedGetLock(config.token, device.loqedLockId);
  if (!lock) {
    return NextResponse.json({ error: error ?? "LOQED war nicht erreichbar." }, { status: 502 });
  }

  const existing = (typeof device.systemInfo === "object" && device.systemInfo !== null)
    ? (device.systemInfo as Record<string, unknown>)
    : {};

  const nextInfo: Record<string, unknown> = {
    ...existing,
    boltState: lock.bolt_state ?? null,
    batteryPercentage: lock.battery_percentage ?? null,
    batteryType: loqedBatteryType(lock.battery_type),
    modelName: lock.model_name ?? null,
    supportedLockStates: lock.supported_lock_states ?? null,
    lockDirection: lock.lock_direction ?? null,
    mortiseLockType: lock.mortise_lock_type ?? null,
    guestAccessMode: lock.guest_access_mode ?? null,
    partyMode: lock.party_mode ?? null,
    twistAssist: lock.twist_assist ?? null,
    refreshedAt: new Date().toISOString(),
  };

  await db.device.update({
    where: { id: device.id },
    data: { systemInfo: nextInfo as Prisma.InputJsonValue, lastUpdate: new Date() },
  });

  return NextResponse.json({ ok: true, systemInfo: nextInfo });
}
