import { NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { processVehicleSighting } from "@/lib/vehicles";

/** Manuell auslösen (Test): Sichtung mit dem Kennzeichen des Fahrzeugs. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;
  const { id } = await params;

  const vehicle = await db.allowedVehicle.findFirst({
    where: { id: Number(id), accountId: accountId! },
  });
  if (!vehicle) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });

  // Cooldown für manuellen Test kurz umgehen.
  await db.allowedVehicle.update({
    where: { id: vehicle.id },
    data: { lastTriggeredAt: null },
  });

  const result = await processVehicleSighting({
    accountId: accountId!,
    plate: vehicle.plate,
    source: "MANUAL",
  });

  return NextResponse.json(result);
}
