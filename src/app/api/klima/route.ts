import { NextRequest, NextResponse } from "next/server";
import { getSessionOrApiToken } from "@/lib/api-auth";
import { CLIMATE_LIMITS, climateView } from "@/lib/room-climate";

/**
 * Klima je Raum (Solltemperatur halten). Sitzung oder Account-Token, damit
 * auch der Hub es pflegen kann.
 *
 * GET              alle Klimas des Mandanten
 * PUT              anlegen oder aendern, Schluessel ist `roomId`
 * DELETE ?roomId=  entfernen; eine laufende Heizung faellt ueber ihren
 *                  Auto-Off-Timer (WATCHDOG_SEC) von selbst ab
 */
export async function GET(request: NextRequest) {
  const auth = await getSessionOrApiToken(request);
  if ("error" in auth) return auth.error;
  const { db, accountId } = auth;
  const list = await db.roomClimate.findMany({
    where: accountId ? { accountId } : {},
    orderBy: { roomId: "asc" },
  });
  return NextResponse.json(list.map(climateView));
}

function num(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v.replace(",", ".")) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

export async function PUT(request: NextRequest) {
  const auth = await getSessionOrApiToken(request);
  if ("error" in auth) return auth.error;
  const { db, accountId } = auth;
  if (!accountId) return NextResponse.json({ error: "Kein Mandant" }, { status: 400 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const bad = (msg: string) => NextResponse.json({ error: msg }, { status: 400 });

  const roomId = Number(body.roomId);
  if (!Number.isInteger(roomId)) return bad("Raum fehlt");
  const room = await db.keyRoom.findFirst({ where: { id: roomId, accountId }, select: { id: true } });
  if (!room) return NextResponse.json({ error: "Raum nicht gefunden" }, { status: 404 });

  const { minC, maxC, maxHysteresisC, maxPreheatMinutes, maxAfterrunMinutes, maxFanAfterrunMinutes } = CLIMATE_LIMITS;
  const targetC = num(body.targetC);
  if (targetC === null || targetC < minC || targetC > maxC) return bad(`Solltemperatur zwischen ${minC} und ${maxC} °C`);
  const setbackC = body.setbackC == null || body.setbackC === "" ? null : num(body.setbackC);
  if (setbackC !== null && (setbackC < minC || setbackC > maxC)) return bad(`Absenkung zwischen ${minC} und ${maxC} °C`);
  if (setbackC !== null && setbackC > targetC) return bad("Absenkung darf nicht über der Solltemperatur liegen");
  const hysteresisC = body.hysteresisC == null ? 0.5 : num(body.hysteresisC);
  if (hysteresisC === null || hysteresisC < 0.1 || hysteresisC > maxHysteresisC) return bad(`Spielraum zwischen 0,1 und ${maxHysteresisC} °C`);
  const preheatMinutes = body.preheatMinutes == null ? 30 : Math.round(num(body.preheatMinutes) ?? -1);
  if (preheatMinutes < 0 || preheatMinutes > maxPreheatMinutes) return bad(`Vorheizen zwischen 0 und ${maxPreheatMinutes} Minuten`);
  const afterrunMinutes = body.afterrunMinutes == null || body.afterrunMinutes === "" ? 0 : Math.round(num(body.afterrunMinutes) ?? -1);
  if (afterrunMinutes < 0 || afterrunMinutes > maxAfterrunMinutes) return bad(`Nachlauf zwischen 0 und ${maxAfterrunMinutes} Minuten`);

  const sensorDeviceId = Number(body.sensorDeviceId);
  const sensor = Number.isInteger(sensorDeviceId)
    ? await db.device.findFirst({ where: { id: sensorDeviceId, accountId, type: "SHELLY" }, select: { id: true } })
    : null;
  if (!sensor) return bad("Temperaturfühler wählen (Shelly)");

  const ids = (v: unknown) =>
    Array.isArray(v) ? [...new Set(v.map(Number).filter((n) => Number.isInteger(n)))] : [];
  const heaterIds = ids(body.heaterDeviceIds);
  const fanIds = ids(body.fanDeviceIds);
  if (heaterIds.length === 0 && fanIds.length === 0) return bad("Mindestens eine Heizung oder Lüftung wählen");
  const switches = await db.device.findMany({
    where: { id: { in: [...heaterIds, ...fanIds] }, accountId, type: "SHELLY" },
    select: { id: true, category: true },
  });
  if (switches.length !== new Set([...heaterIds, ...fanIds]).size) return bad("Heizung oder Lüftung nicht gefunden (nur Shelly-Schalter)");
  if (switches.some((h) => h.category === "MARKISE" || h.category === "ROLLTOR" || h.category === "SENSOR")) {
    return bad("Für Heizung und Lüftung nur Schalter wählen");
  }
  if (heaterIds.includes(sensorDeviceId) || fanIds.includes(sensorDeviceId)) {
    return bad("Fühler und Schalter müssen verschiedene Geräte sein");
  }
  if (heaterIds.some((id) => fanIds.includes(id))) return bad("Ein Gerät kann nicht Heizung und Lüftung zugleich sein");

  const fanOnHumidity = body.fanOnHumidity == null || body.fanOnHumidity === "" ? 65 : num(body.fanOnHumidity);
  const fanOffHumidity = body.fanOffHumidity == null || body.fanOffHumidity === "" ? 58 : num(body.fanOffHumidity);
  if (fanOnHumidity === null || fanOnHumidity < 30 || fanOnHumidity > 95) return bad("Lüftung an: Luftfeuchte zwischen 30 und 95 %");
  if (fanOffHumidity === null || fanOffHumidity < 20 || fanOffHumidity >= fanOnHumidity) {
    return bad("Lüftung aus: Luftfeuchte unter dem Einschaltwert");
  }
  const fanAfterrunMinutes =
    body.fanAfterrunMinutes == null || body.fanAfterrunMinutes === "" ? 45 : Math.round(num(body.fanAfterrunMinutes) ?? -1);
  if (fanAfterrunMinutes < 0 || fanAfterrunMinutes > maxFanAfterrunMinutes) {
    return bad(`Lüftungs-Nachlauf zwischen 0 und ${maxFanAfterrunMinutes} Minuten`);
  }
  const fanMinTempC = body.fanMinTempC == null || body.fanMinTempC === "" ? 8 : num(body.fanMinTempC);
  if (fanMinTempC === null || fanMinTempC < 0 || fanMinTempC > 20) return bad("Frostschutz der Lüftung zwischen 0 und 20 °C");

  let operatingScheduleId: number | null = null;
  if (body.operatingScheduleId != null && body.operatingScheduleId !== "") {
    operatingScheduleId = Number(body.operatingScheduleId);
    const sched = await db.operatingSchedule.findFirst({ where: { id: operatingScheduleId, accountId }, select: { id: true } });
    if (!sched) return bad("Betriebszeit nicht gefunden");
  }

  const data = {
    isActive: body.isActive !== false,
    sensorDeviceId,
    heaterDeviceIds: heaterIds,
    targetC,
    hysteresisC,
    setbackC,
    preheatMinutes,
    afterrunMinutes,
    fanDeviceIds: fanIds,
    fanOnHumidity,
    fanOffHumidity,
    fanAfterrunMinutes,
    fanMinTempC,
    operatingScheduleId,
  };
  const climate = await db.roomClimate.upsert({
    where: { roomId },
    create: { accountId, roomId, ...data },
    // Neue Einstellungen: Fehler zuruecksetzen, der naechste Takt bewertet neu.
    update: { ...data, lastError: null },
  });
  return NextResponse.json(climateView(climate));
}

export async function DELETE(request: NextRequest) {
  const auth = await getSessionOrApiToken(request);
  if ("error" in auth) return auth.error;
  const { db, accountId } = auth;
  if (!accountId) return NextResponse.json({ error: "Kein Mandant" }, { status: 400 });
  const roomId = Number(request.nextUrl.searchParams.get("roomId"));
  if (!Number.isInteger(roomId)) return NextResponse.json({ error: "Raum fehlt" }, { status: 400 });
  const res = await db.roomClimate.deleteMany({ where: { roomId, accountId } });
  return NextResponse.json({ ok: true, deleted: res.count });
}
