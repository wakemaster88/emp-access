import { NextRequest, NextResponse } from "next/server";
import { publicRateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { triggerDeviceAction } from "@/lib/device-open";
import { KIOSK_DOOR_DENIED_MESSAGE, kioskDoorAllowed } from "@/lib/link-rules";
import { loadLinkRulesOrStrict } from "@/lib/link-rules-cache";

/**
 * Quick-Open-Endpoint für den oeffentlichen Check-In Monitor. Validiert
 * Monitor-Token und Account-Zugehoerigkeit des Geraets, bevor der
 * Oeffnen-Befehl gesendet wird.
 *
 * Der Kiosk-Token steckt in einer URL und darf deshalb nur "einmal oeffnen"
 * ausloesen. NOT-AUF ("emergency") und Sperren ("deactivate") bleiben dem
 * angemeldeten Dashboard vorbehalten: bei NOT-AUF laesst der Pi jeden Scan
 * ohne Serverpruefung durch.
 *
 * Ist die Regel „Kiosk-Link oeffnet nur zugeordnete Tueren“ an
 * (lib/link-rules), oeffnet der Kiosk nur die Geraete aus
 * `MonitorConfig.deviceIds`.
 */
const KIOSK_ACTIONS = ["open"] as const;
type KioskAction = (typeof KIOSK_ACTIONS)[number];
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string; id: string }> },
) {
  const { token, id } = await params;
  const limited = publicRateLimit(token, "checkin-device-action");
  if (limited) return limited;
  const monitor = await prisma.monitorConfig.findUnique({
    where: { token },
    select: { id: true, accountId: true, isActive: true, type: true, deviceIds: true },
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
  if (!(KIOSK_ACTIONS as readonly string[]).includes(action)) {
    return NextResponse.json({ error: "Ungültige Aktion" }, { status: 400 });
  }

  const device = await prisma.device.findFirst({
    where: { id: deviceId, accountId: monitor.accountId },
    select: {
      id: true,
      name: true,
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
  const linkRules = await loadLinkRulesOrStrict(prisma, monitor.accountId);
  if (!kioskDoorAllowed(linkRules, monitor.deviceIds, device.id)) {
    return NextResponse.json({ error: KIOSK_DOOR_DENIED_MESSAGE }, { status: 403 });
  }

  const { task, sent } = await triggerDeviceAction(
    prisma,
    device,
    monitor.accountId,
    action as KioskAction,
    { actor: { source: "kiosk", actorLabel: `monitor:${monitor.id}` } },
  );

  return NextResponse.json({ ok: true, task, sent });
}
