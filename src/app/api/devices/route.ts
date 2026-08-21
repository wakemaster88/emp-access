import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb, validateApiToken } from "@/lib/api-auth";
import { isCoverCategory, parseCoverInput } from "@/lib/cover-constants";
import { isPulseCategory, parsePulseInput } from "@/lib/pulse-constants";
import { withAudioDeviceInfo, AUDIO_ZONE_SELECT } from "@/lib/audio-integration";

function hasApiToken(request: NextRequest) {
  return request.nextUrl.searchParams.has("token") || request.headers.has("authorization");
}

const VALID_CATEGORIES = [
  "DREHKREUZ", "TUER", "SENSOR", "SCHALTER", "BELEUCHTUNG", "MARKISE", "ROLLTOR",
  "TASTER",
];

export async function GET(request: NextRequest) {
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
  const devices = await db.device.findMany({
    where: { accountId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      type: true,
      category: true,
      isActive: true,
      task: true,
      accessIn: true,
      accessOut: true,
      lastUpdate: true,
      // Antriebe (MARKISE/ROLLTOR): Kanalzuordnung und Fahrzeit.
      coverUpChannel: true,
      coverDownChannel: true,
      coverRuntimeSec: true,
      // Taster: Einschaltdauer.
      pulseSeconds: true,
      audioZone: { select: AUDIO_ZONE_SELECT },
    },
  });

  return NextResponse.json(devices.map(withAudioDeviceInfo));
}

export async function POST(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const body = await request.json();
  if (!body.name?.trim()) {
    return NextResponse.json({ error: "Name ist erforderlich" }, { status: 400 });
  }
  if (!["RASPBERRY_PI", "SHELLY", "NUKI_SMARTLOCK", "LOQED_SMARTLOCK", "AUDIO_PLAYER"].includes(body.type)) {
    return NextResponse.json({ error: "Ungültiger Gerätetyp" }, { status: 400 });
  }

  // Ein Abspieler bedient immer genau eine Beschallungszone – seine Funktion
  // steht damit fest. Umgekehrt bleibt AUDIO den Abspielern vorbehalten, denn
  // ohne Abspieler-Client gibt es an der Kategorie nichts zu steuern.
  const category = body.type === "AUDIO_PLAYER"
    ? "AUDIO"
    : body.category && VALID_CATEGORIES.includes(body.category) ? body.category : null;

  // Antriebe brauchen zwei schaltbare Relais – das gibt es nur beim Shelly.
  if (isCoverCategory(category) && body.type !== "SHELLY") {
    return NextResponse.json(
      { error: "Markise und Rolltor lassen sich nur mit einem Shelly steuern" },
      { status: 400 },
    );
  }

  // Ein Taster laesst das Relais nach der Einschaltdauer selbst wieder
  // abfallen – diesen Auto-Off-Timer kennt nur der Shelly.
  if (isPulseCategory(category) && body.type !== "SHELLY") {
    return NextResponse.json(
      { error: "Ein Taster lässt sich nur mit einem Shelly steuern" },
      { status: 400 },
    );
  }

  const cover = parseCoverInput(body, isCoverCategory(category));
  if (!cover.ok) return NextResponse.json({ error: cover.error }, { status: 400 });

  const pulse = parsePulseInput(body, isPulseCategory(category));
  if (!pulse.ok) return NextResponse.json({ error: pulse.error }, { status: 400 });

  const { db, accountId } = session;

  const device = await db.device.create({
    data: {
      name: body.name.trim(),
      type: body.type,
      category,
      ...cover.value,
      ...pulse.value,
      ipAddress: body.ipAddress || null,
      shellyId: body.shellyId || null,
      shellyAuthKey: body.shellyAuthKey || null,
      nukiSmartlockId: body.nukiSmartlockId || null,
      loqedLockId: body.loqedLockId || null,
      isActive: body.isActive ?? true,
      accessIn: body.accessIn ? Number(body.accessIn) : null,
      accessOut: body.accessOut ? Number(body.accessOut) : null,
      allowReentry: body.allowReentry ?? false,
      schedule: body.schedule ?? null,
      accountId: accountId!,
    },
  });

  return NextResponse.json(withAudioDeviceInfo(device), { status: 201 });
}
