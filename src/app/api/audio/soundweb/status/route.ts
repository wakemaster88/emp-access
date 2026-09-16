import { NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { soundwebOnline } from "@/lib/soundweb";
import { hubOnline } from "@/lib/soundweb-server";

/**
 * Ist-Zustand der Soundweb-Prozessoren für die Karte: Verbindung je Gerät und
 * Werte je Regler. Schlank, weil der Tab das alle paar Sekunden abfragt.
 */
export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const [devices, controls, hub] = await Promise.all([
    db.soundwebDevice.findMany({
      where: { accountId: accountId! },
      select: { id: true, connected: true, lastSeenAt: true, lastError: true, hubName: true },
    }),
    db.soundwebControl.findMany({
      where: { accountId: accountId! },
      select: { id: true, value: true, valueAt: true },
    }),
    hubOnline(db, accountId!),
  ]);

  return NextResponse.json({
    hubOnline: hub,
    devices: devices.map((d) => ({
      id: d.id,
      connected: d.connected,
      online: soundwebOnline(d),
      lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
      lastError: d.lastError,
      hubName: d.hubName,
    })),
    controls: controls.map((c) => ({
      id: c.id,
      value: c.value,
      valueAt: c.valueAt?.toISOString() ?? null,
    })),
  });
}
