import { NextRequest, NextResponse } from "next/server";
import { publicRateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { triggerDeviceAction, DEVICE_TASK_MAP } from "@/lib/device-open";

/**
 * Quick-Open-Endpoint für den oeffentlichen Check-In Monitor. Validiert
 * Monitor-Token und Geraete-Zugehoerigkeit (Account + optional die im
 * MonitorConfig hinterlegten deviceIds), bevor der Open-/Reset-Befehl an
 * das Geraet gesendet wird.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string; id: string }> },
) {
  const { token, id } = await params;
  const limited = publicRateLimit(token, "checkin-device-action");
  if (limited) return limited;
  const monitor = await prisma.monitorConfig.findUnique({
    where: { token },
    select: { id: true, accountId: true, isActive: true, type: true },
  });
  if (!monitor || !monitor.isActive || monitor.type !== "CHECKIN") {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const deviceId = Number(id);
  if (isNaN(deviceId)) {
    return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as { action?: string };
  const action = body.action ?? "open";
  if (!(action in DEVICE_TASK_MAP)) {
    return NextResponse.json({ error: "Ungültige Aktion" }, { status: 400 });
  }

  const device = await prisma.device.findFirst({
    where: { id: deviceId, accountId: monitor.accountId },
    select: {
      id: true,
      type: true,
      shellyId: true,
      ipAddress: true,
      category: true,
    },
  });
  if (!device) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  // Über den Public-Monitor lassen wir nur Tueren/Drehkreuze auf, nicht
  // Schalter/Beleuchtung – das passt zur UX "Reinlassen".
  if (device.category !== "TUER" && device.category !== "DREHKREUZ") {
    return NextResponse.json({ error: "Gerät nicht öffnenbar" }, { status: 400 });
  }

  const { task, sent } = await triggerDeviceAction(
    prisma,
    device,
    monitor.accountId,
    action as keyof typeof DEVICE_TASK_MAP,
  );

  return NextResponse.json({ ok: true, task, sent });
}
