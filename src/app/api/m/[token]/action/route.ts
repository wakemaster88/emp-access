import { NextRequest, NextResponse } from "next/server";
import { prisma, tenantClient } from "@/lib/prisma";
import {
  triggerDeviceAction,
  isValidDeviceAction,
  isActionAllowedForDevice,
  deviceSendsRemoteCommand,
} from "@/lib/device-open";
import { loadEmployeeByMobileToken } from "@/lib/employee-access";

/**
 * Mitarbeiter-PWA: Schaltbefehl an ein Geraet aus der eigenen Whitelist.
 *
 * Body: { deviceId: number, action: "open" | "deactivate" | "reset" | "emergency" }
 *
 * Sicherheit:
 *   - Authentifizierung ueber den URL-Token (kein Login).
 *   - Geraet muss in der per-Mitarbeiter Whitelist (Direkt-Geraete +
 *     Bereich-Geraete) liegen, sonst 403.
 *   - Wochenplan/Vertrag wird hier server-seitig geprueft (Client kann das
 *     UI nicht umgehen).
 *   - Jeder Aufruf wird als Scan gespeichert
 *     (`code = "mobile:<ticketId>:<action>"`, deviceId gesetzt). Damit
 *     taucht die Aktion in Scans/Live-Monitor wie ein normaler Zutritt auf.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 8) {
    return NextResponse.json({ error: "Invalid token" }, { status: 404 });
  }

  const profile = await loadEmployeeByMobileToken(token);
  if (!profile) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: { deviceId?: number; action?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const deviceId = Number(body.deviceId);
  const action = String(body.action ?? "");
  if (!deviceId || Number.isNaN(deviceId)) {
    return NextResponse.json({ error: "deviceId fehlt" }, { status: 400 });
  }
  if (!isValidDeviceAction(action)) {
    return NextResponse.json({ error: "Ungueltige Aktion" }, { status: 400 });
  }

  // Whitelist-Pruefung.
  const device = profile.devices.find((d) => d.id === deviceId);
  if (!device) {
    return NextResponse.json({ error: "Geraet nicht freigegeben" }, { status: 403 });
  }

  // Vertrag + Wochenplan.
  if (!profile.contractOk) {
    return NextResponse.json(
      { error: profile.contractReason ?? "Vertrag inaktiv" },
      { status: 403 },
    );
  }
  if (profile.scheduleCheck && !profile.scheduleCheck.ok) {
    return NextResponse.json(
      { error: profile.scheduleCheck.reason ?? "Ausserhalb der freigegebenen Zeit" },
      { status: 403 },
    );
  }

  // Geraet vollstaendig laden (Schloss-Kennungen, shellyId, ipAddress) - wird
  // von `triggerDeviceAction` benoetigt. `category` und die Cover-Kanaele
  // entscheiden, ob ein Shelly als Schalter oder als Antrieb geschaltet wird;
  // `pulseSeconds` ist die Einschaltdauer eines Tasters.
  const fullDevice = await prisma.device.findFirst({
    where: { id: deviceId, accountId: profile.accountId },
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
  if (!fullDevice) {
    return NextResponse.json({ error: "Geraet nicht gefunden" }, { status: 404 });
  }
  if (!isActionAllowedForDevice(action, fullDevice)) {
    return NextResponse.json(
      { error: "Aktion ist fuer dieses Geraet nicht vorgesehen" },
      { status: 400 },
    );
  }

  const db = tenantClient(profile.accountId);
  let task = 0;
  let sent = false;
  let actionError: string | undefined;
  try {
    const res = await triggerDeviceAction(
      db,
      fullDevice,
      profile.accountId,
      action,
    );
    task = res.task;
    sent = res.sent;
    actionError = res.error;
  } catch (err) {
    await prisma.scan.create({
      data: {
        accountId: profile.accountId,
        deviceId: fullDevice.id,
        ticketId: profile.id,
        code: `mobile:${profile.id}:${action}`,
        note: `PWA-Fehler: ${err instanceof Error ? err.message : "unbekannt"}`,
        result: "DENIED",
      },
    });
    return NextResponse.json({ error: "Aktion fehlgeschlagen" }, { status: 502 });
  }

  // Scan-Log: GRANTED, wenn die Aktion versendet wurde oder kein Remote-
  // Versand noetig war (Pi setzt nur task=1, kein "sent"-Signal).
  const isRemoteDevice = deviceSendsRemoteCommand(fullDevice.type);
  const result = isRemoteDevice ? (sent ? "GRANTED" : "DENIED") : "GRANTED";
  // Der Grund gehoert in den Verlauf. Ein blankes "Remote-Fehler" laesst
  // hinterher niemanden erkennen, ob das Geraet stumm war oder gar keinen
  // Befehl annimmt.
  const note = isRemoteDevice && !sent
    ? `PWA ${action} fehlgeschlagen: ${actionError ?? "Gerät antwortete nicht"}`.slice(0, 250)
    : `PWA ${action}${isRemoteDevice ? " ok" : ""}`;
  await prisma.scan.create({
    data: {
      accountId: profile.accountId,
      deviceId: fullDevice.id,
      ticketId: profile.id,
      code: `mobile:${profile.id}:${action}`,
      note,
      result,
    },
  });

  // Bisher meldete die App auch dann Erfolg, wenn der Befehl nie ankam –
  // deshalb hat es am Technikraum niemand gemerkt und immer wieder gedrueckt.
  if (isRemoteDevice && !sent) {
    return NextResponse.json(
      { error: actionError ?? "Gerät nicht erreichbar – der Befehl kam nicht an." },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    task,
    sent,
    deviceId: fullDevice.id,
    deviceType: fullDevice.type,
  });
}
