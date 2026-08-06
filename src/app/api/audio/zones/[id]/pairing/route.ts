/**
 * Bluetooth-Kopplung einer Zone freigeben.
 *
 * Bewusst kein AudioJob: der Abspieler liest die Restlaufzeit bei seinem
 * ohnehin laufenden Poll aus der Zonenkonfiguration. Damit findet er auch nach
 * einem Neustart mitten im Fenster in den richtigen Zustand zurück, während ein
 * einmalig zugestellter Job verloren wäre.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { PAIRING_WINDOW_SEC, pairableSeconds } from "@/lib/audio";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const { id } = await params;
  const zoneId = Number(id);
  if (isNaN(zoneId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const zone = await db.audioZone.findFirst({
    where: { id: zoneId, accountId: accountId! },
    select: { id: true, bluetoothEnabled: true },
  });
  if (!zone) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  if (!zone.bluetoothEnabled) {
    return NextResponse.json(
      { error: "Für diese Zone ist der Bluetooth-Empfang nicht eingeschaltet" },
      { status: 400 },
    );
  }

  const pairableUntil = new Date(Date.now() + PAIRING_WINDOW_SEC * 1000);
  await db.audioZone.update({ where: { id: zoneId }, data: { pairableUntil } });

  return NextResponse.json({
    ok: true,
    pairableUntil: pairableUntil.toISOString(),
    pairableFor: pairableSeconds(pairableUntil),
  });
}

/** Kopplung vorzeitig wieder schließen. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const { id } = await params;
  const zoneId = Number(id);
  if (isNaN(zoneId)) return NextResponse.json({ error: "Ungültige ID" }, { status: 400 });

  const zone = await db.audioZone.findFirst({
    where: { id: zoneId, accountId: accountId! },
    select: { id: true },
  });
  if (!zone) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  await db.audioZone.update({ where: { id: zoneId }, data: { pairableUntil: null } });
  return NextResponse.json({ ok: true });
}
