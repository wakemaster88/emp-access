import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb, validateApiToken } from "@/lib/api-auth";
import { isCoverCategory, parseCoverInput } from "@/lib/cover-constants";
import { isPulseCategory, parsePulseInput } from "@/lib/pulse-constants";
import { parseScanLockSeconds } from "@/lib/scan-lock";
import { withAudioDeviceInfo, AUDIO_ZONE_SELECT } from "@/lib/audio-integration";

function hasApiToken(request: NextRequest) {
  return request.nextUrl.searchParams.has("token") || request.headers.has("authorization");
}

const VALID_CATEGORIES = [
  "DREHKREUZ", "TUER", "SENSOR", "SCHALTER", "BELEUCHTUNG", "MARKISE", "ROLLTOR",
  "TASTER",
];

export async function GET(
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

  const device = await db.device.findFirst({
    where: { id: deviceId, accountId },
    include: {
      _count: { select: { scans: true } },
      audioZone: { select: AUDIO_ZONE_SELECT },
    },
  });
  if (!device) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  return NextResponse.json(withAudioDeviceInfo(device));
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { id } = await params;
  const deviceId = Number(id);
  if (isNaN(deviceId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const body = await request.json();
  const { db, accountId } = session;

  const existing = await db.device.findFirst({
    where: { id: deviceId, accountId: accountId! },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  // Die Funktion eines Abspielers steht fest (Beschallungszone) und darf auch
  // dann nicht wegfallen, wenn das Formular sie nicht mitschickt.
  const category = existing.type === "AUDIO_PLAYER"
    ? "AUDIO"
    : body.category !== undefined
      ? (body.category && VALID_CATEGORIES.includes(body.category) ? body.category : null)
      : existing.category;

  if (isCoverCategory(category) && existing.type !== "SHELLY") {
    return NextResponse.json(
      { error: "Markise und Rolltor lassen sich nur mit einem Shelly steuern" },
      { status: 400 },
    );
  }

  if (isPulseCategory(category) && existing.type !== "SHELLY") {
    return NextResponse.json(
      { error: "Ein Taster lässt sich nur mit einem Shelly steuern" },
      { status: 400 },
    );
  }

  const cover = parseCoverInput(body, isCoverCategory(category), {
    coverUpChannel: existing.coverUpChannel,
    coverDownChannel: existing.coverDownChannel,
    coverRuntimeSec: existing.coverRuntimeSec,
  });
  if (!cover.ok) return NextResponse.json({ error: cover.error }, { status: 400 });

  const pulse = parsePulseInput(body, isPulseCategory(category), existing.pulseSeconds);
  if (!pulse.ok) return NextResponse.json({ error: pulse.error }, { status: 400 });

  // Ventil → Pumpe Zuordnung. null/0 loest die Zuordnung; ein Wert muss ein
  // anderes Geraet desselben Accounts sein (kein Selbstbezug).
  let pumpDeviceId = existing.pumpDeviceId;
  if (body.pumpDeviceId !== undefined) {
    const raw = body.pumpDeviceId;
    if (raw === null || raw === 0) {
      pumpDeviceId = null;
    } else {
      const pumpId = Number(raw);
      if (!Number.isInteger(pumpId) || pumpId === deviceId) {
        return NextResponse.json({ error: "Ungültige Pumpe" }, { status: 400 });
      }
      const pump = await db.device.findFirst({ where: { id: pumpId, accountId: accountId! } });
      if (!pump) return NextResponse.json({ error: "Pumpe nicht gefunden" }, { status: 400 });
      pumpDeviceId = pumpId;
    }
  }

  // Kamera-Zuordnung: Kamera, die diesen Zugang im Blick hat. null/0 loest
  // die Zuordnung; ein Wert muss eine Kamera desselben Accounts sein.
  let cameraId = existing.cameraId;
  if (body.cameraId !== undefined) {
    const raw = body.cameraId;
    if (raw === null || raw === 0) {
      cameraId = null;
    } else {
      const camId = Number(raw);
      if (!Number.isInteger(camId)) {
        return NextResponse.json({ error: "Ungültige Kamera" }, { status: 400 });
      }
      const cam = await db.camera.findFirst({
        where: { id: camId, accountId: accountId! },
        select: { id: true },
      });
      if (!cam) return NextResponse.json({ error: "Kamera nicht gefunden" }, { status: 400 });
      cameraId = camId;
    }
  }

  // Zonen-Stammdaten fuer die Wasserbilanz: Durchsatz (L/h, wie an der Pumpe
  // angezeigt) und Flaeche (m²). null/0 loescht den Wert.
  const parseMetric = (raw: unknown, current: number | null, max: number): number | null => {
    if (raw === undefined) return current;
    if (raw === null || raw === 0 || raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.min(max, n) : current;
  };
  const flowLph = parseMetric(body.flowLph, existing.flowLph, 30000);
  const areaSqm = parseMetric(body.areaSqm, existing.areaSqm, 10000);

  const device = await db.device.update({
    where: { id: deviceId },
    data: {
      name: body.name ?? existing.name,
      pumpDeviceId,
      cameraId,
      flowLph,
      areaSqm,
      category,
      ...cover.value,
      ...pulse.value,
      ipAddress: body.ipAddress ?? existing.ipAddress,
      shellyId: body.shellyId ?? existing.shellyId,
      shellyAuthKey: body.shellyAuthKey ?? existing.shellyAuthKey,
      nukiSmartlockId: body.nukiSmartlockId ?? existing.nukiSmartlockId,
      loqedLockId: body.loqedLockId ?? existing.loqedLockId,
      isActive: body.isActive ?? existing.isActive,
      accessIn: body.accessIn ?? existing.accessIn,
      accessOut: body.accessOut ?? existing.accessOut,
      allowReentry: body.allowReentry ?? existing.allowReentry,
      scanLockSeconds: parseScanLockSeconds(body.scanLockSeconds, existing.scanLockSeconds),
      offlineAlertsEnabled: typeof body.offlineAlertsEnabled === "boolean"
        ? body.offlineAlertsEnabled
        : existing.offlineAlertsEnabled,
      firmware: body.firmware ?? existing.firmware,
      schedule: body.schedule !== undefined ? (body.schedule ?? null) : existing.schedule,
    },
  });

  return NextResponse.json(withAudioDeviceInfo(device));
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { id } = await params;
  const deviceId = Number(id);
  if (isNaN(deviceId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const { db, accountId } = session;

  const existing = await db.device.findFirst({
    where: { id: deviceId, accountId: accountId! },
  });
  if (!existing) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  await db.device.delete({ where: { id: deviceId } });

  return NextResponse.json({ ok: true });
}
