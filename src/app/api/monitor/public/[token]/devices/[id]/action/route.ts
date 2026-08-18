import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseMonitorIdList } from "@/lib/monitor-public-poll";
import { deviceControls } from "@/lib/device-controls";
import {
  triggerDeviceAction,
  isValidDeviceAction,
  isActionAllowedForDevice,
  deviceSendsRemoteCommand,
} from "@/lib/device-open";

/**
 * Steuer-Endpoint fuer den oeffentlichen Scan-Monitor. Nur Geraete aus
 * `MonitorConfig.controlDeviceIds` und nur Aktionen, die zum Geraet gehoeren.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string; id: string }> },
) {
  const { token, id } = await params;
  const monitor = await prisma.monitorConfig.findUnique({
    where: { token },
    select: {
      id: true,
      accountId: true,
      isActive: true,
      type: true,
      controlDeviceIds: true,
    },
  });
  if (!monitor || !monitor.isActive || monitor.type !== "MONITOR") {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const deviceId = Number(id);
  if (!Number.isFinite(deviceId) || deviceId <= 0) {
    return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  }

  const allowedIds = parseMonitorIdList(monitor.controlDeviceIds);
  if (!allowedIds.includes(deviceId)) {
    return NextResponse.json({ error: "Gerät nicht freigegeben" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { action?: string };
  const action = String(body.action ?? "");
  if (!isValidDeviceAction(action)) {
    return NextResponse.json({ error: "Ungültige Aktion" }, { status: 400 });
  }

  const device = await prisma.device.findFirst({
    where: { id: deviceId, accountId: monitor.accountId },
    select: {
      id: true,
      type: true,
      category: true,
      shellyId: true,
      ipAddress: true,
      coverUpChannel: true,
      coverDownChannel: true,
      coverRuntimeSec: true,
      pulseSeconds: true,
      nukiSmartlockId: true,
      loqedLockId: true,
      gardenaServiceId: true,
      gardenaConfigId: true,
      pumpDeviceId: true,
    },
  });
  if (!device) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  const allowedActions = deviceControls(device).map((c) => c.action);
  if (!allowedActions.includes(action) || !isActionAllowedForDevice(action, device)) {
    return NextResponse.json({ error: "Aktion ist für dieses Gerät nicht vorgesehen" }, { status: 400 });
  }

  const { task, sent, error } = await triggerDeviceAction(
    prisma,
    device,
    monitor.accountId,
    action,
  );

  const hasRemoteAction = deviceSendsRemoteCommand(device.type);
  if (hasRemoteAction && !sent) {
    return NextResponse.json(
      { error: error ?? "Gerät nicht erreichbar – der Befehl kam nicht an." },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    task,
    sent: hasRemoteAction ? sent : undefined,
  });
}
