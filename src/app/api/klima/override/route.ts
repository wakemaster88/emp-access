import { NextRequest, NextResponse } from "next/server";
import { getSessionOrApiToken } from "@/lib/api-auth";
import { CLIMATE_LIMITS, climateView } from "@/lib/room-climate";

/**
 * Klima uebersteuern mit Ablauf („22 °C bis 18:00“): das Soll gilt bis zu
 * einem Zeitpunkt, danach wieder der Plan. Verhindert vergessene 24 °C.
 *
 * POST   { roomId, targetC, until?: ISO, minutes?: number }  setzen (eines von until/minutes)
 * DELETE ?roomId=                                             aufheben
 */
const MAX_HOURS = 24;

export async function POST(request: NextRequest) {
  const auth = await getSessionOrApiToken(request);
  if ("error" in auth) return auth.error;
  const { db, accountId } = auth;
  if (!accountId) return NextResponse.json({ error: "Kein Mandant" }, { status: 400 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const bad = (msg: string) => NextResponse.json({ error: msg }, { status: 400 });
  const roomId = Number(body.roomId);
  if (!Number.isInteger(roomId)) return bad("Raum fehlt");
  const targetC = typeof body.targetC === "number" ? body.targetC : Number(body.targetC);
  const { minC, maxC } = CLIMATE_LIMITS;
  if (!Number.isFinite(targetC) || targetC < minC || targetC > maxC) return bad(`Soll zwischen ${minC} und ${maxC} °C`);

  const now = Date.now();
  let until: number | null = null;
  if (typeof body.until === "string") until = Date.parse(body.until);
  else if (body.minutes != null) until = now + Number(body.minutes) * 60_000;
  if (until == null || !Number.isFinite(until) || until <= now + 60_000) return bad("Ablauf muss in der Zukunft liegen");
  if (until > now + MAX_HOURS * 3_600_000) return bad(`Höchstens ${MAX_HOURS} Stunden`);

  const climate = await db.roomClimate.findFirst({ where: { roomId, accountId }, select: { id: true, heaterDeviceIds: true } });
  if (!climate) return NextResponse.json({ error: "Keine Klimaregelung für diesen Raum" }, { status: 404 });

  const rounded = Math.round(targetC * 2) / 2;
  const updated = await db.roomClimate.update({
    where: { id: climate.id },
    data: {
      overrideC: rounded,
      overrideUntil: new Date(until),
      // Anzeige sofort, der Takt zieht die Heizung innerhalb von 5 Minuten nach.
      ...(climate.heaterDeviceIds.length > 0 ? { currentTargetC: rounded } : {}),
    },
  });
  return NextResponse.json(climateView(updated));
}

export async function DELETE(request: NextRequest) {
  const auth = await getSessionOrApiToken(request);
  if ("error" in auth) return auth.error;
  const { db, accountId } = auth;
  if (!accountId) return NextResponse.json({ error: "Kein Mandant" }, { status: 400 });

  const roomId = Number(request.nextUrl.searchParams.get("roomId"));
  if (!Number.isInteger(roomId)) return NextResponse.json({ error: "Raum fehlt" }, { status: 400 });
  const climate = await db.roomClimate.findFirst({ where: { roomId, accountId }, select: { id: true } });
  if (!climate) return NextResponse.json({ error: "Keine Klimaregelung für diesen Raum" }, { status: 404 });

  const updated = await db.roomClimate.update({
    where: { id: climate.id },
    data: { overrideC: null, overrideUntil: null },
  });
  return NextResponse.json(climateView(updated));
}
