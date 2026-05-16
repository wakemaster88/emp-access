import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import {
  nukiGetSmartlock,
  NUKI_DEVICE_TYPE_LABEL,
  nukiStateLabel,
} from "@/lib/nuki";
import type { Prisma } from "@prisma/client";

/**
 * POST /api/devices/[id]/nuki-refresh
 *
 * Holt live den aktuellen Zustand eines Nuki Smart Locks (inkl. Battery)
 * und persistiert das in `Device.systemInfo`. Antwort enthaelt das frische
 * Status-Objekt fuer sofortige UI-Anzeige.
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
    return NextResponse.json({ error: "Ungueltige ID" }, { status: 400 });
  }

  const device = await db.device.findFirst({
    where: { id: deviceId, accountId: accountId!, type: "NUKI_SMARTLOCK" },
  });
  if (!device) {
    return NextResponse.json({ error: "Nuki-Geraet nicht gefunden" }, { status: 404 });
  }
  if (!device.nukiSmartlockId) {
    return NextResponse.json({ error: "Geraet hat keine Nuki-ID" }, { status: 400 });
  }

  const config = await db.apiConfig.findFirst({
    where: { accountId: accountId!, provider: "NUKI" },
  });
  if (!config) {
    return NextResponse.json({ error: "Nuki nicht konfiguriert" }, { status: 404 });
  }

  const lock = await nukiGetSmartlock(config.token, device.nukiSmartlockId);
  if (!lock) {
    return NextResponse.json({ error: "Nuki API nicht erreichbar" }, { status: 502 });
  }

  const typeLabel = lock.type != null
    ? (NUKI_DEVICE_TYPE_LABEL[lock.type] ?? "Smart Lock")
    : "Smart Lock";

  const existingInfo = (typeof device.systemInfo === "object" && device.systemInfo !== null)
    ? (device.systemInfo as Record<string, unknown>)
    : {};

  const nextInfo: Record<string, unknown> = {
    ...existingInfo,
    nukiType: lock.type ?? null,
    nukiTypeLabel: typeLabel,
    state: lock.state ?? null,
    stateLabel: nukiStateLabel(lock.state?.state),
    serverState: lock.serverState ?? null,
    batteryCharge: lock.state?.batteryCharge ?? null,
    batteryCritical: lock.state?.batteryCritical ?? null,
    batteryCharging: lock.state?.batteryCharging ?? null,
    keypadBatteryCritical: lock.state?.keypadBatteryCritical ?? null,
    virtualDevice: lock.virtualDevice ?? null,
    refreshedAt: new Date().toISOString(),
  };

  await db.device.update({
    where: { id: device.id },
    data: {
      systemInfo: nextInfo as Prisma.InputJsonValue,
      firmware: lock.firmwareVersion != null ? String(lock.firmwareVersion) : device.firmware,
      lastUpdate: new Date(),
    },
  });

  return NextResponse.json({ ok: true, systemInfo: nextInfo });
}
