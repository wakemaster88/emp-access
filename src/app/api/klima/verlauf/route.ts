import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { isHistoryRange, roomHistory } from "@/lib/climate-history";

/**
 * GET ?roomId=&range=day|week|month|year
 *
 * Verlauf von Temperatur und Luftfeuchte eines Raums, je Fuehler eine Reihe,
 * verdichtet auf das Anzeigefenster des Zeitraums (siehe RANGE_SPEC).
 */
export async function GET(request: NextRequest) {
  const auth = await getSessionWithDb();
  if ("error" in auth) return auth.error;
  const { db, accountId } = auth;

  const roomId = Number(request.nextUrl.searchParams.get("roomId"));
  const range = request.nextUrl.searchParams.get("range") ?? "day";
  if (!Number.isInteger(roomId) || roomId <= 0) return NextResponse.json({ error: "Raum fehlt" }, { status: 400 });
  if (!isHistoryRange(range)) return NextResponse.json({ error: "Zeitraum unbekannt" }, { status: 400 });

  // Der Raum muss zum Mandanten gehoeren; der Super-Admin sieht jeden.
  const room = await db.keyRoom.findFirst({
    where: { id: roomId, ...(accountId ? { accountId } : {}) },
    select: { id: true, accountId: true, climate: { select: { targetC: true, hysteresisC: true, isActive: true } } },
  });
  if (!room) return NextResponse.json({ error: "Raum nicht gefunden" }, { status: 404 });

  const history = await roomHistory(room.accountId, room.id, range, Date.now());
  return NextResponse.json({
    range,
    ...history,
    target: room.climate?.isActive ? { targetC: room.climate.targetC, hysteresisC: room.climate.hysteresisC } : null,
  });
}
