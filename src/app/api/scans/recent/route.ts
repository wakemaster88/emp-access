import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

/**
 * GET (Session): Letzte Scans von Geraeten mit verknuepfter Kamera
 * (Device.cameraId). Wird vom Webcam-Kontrollzentrum gepollt, um beim Scan
 * Name + Ticket kurz auf der Kamera-Kachel einzublenden.
 *
 * Query: ?seconds=30 (Zeitfenster, max. 120)
 */
export async function GET(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const secondsRaw = Number(request.nextUrl.searchParams.get("seconds") ?? 30);
  const seconds = Number.isFinite(secondsRaw) ? Math.min(120, Math.max(5, secondsRaw)) : 30;
  const since = new Date(Date.now() - seconds * 1000);

  const scans = await db.scan.findMany({
    where: {
      accountId: accountId!,
      scanTime: { gte: since },
      device: { cameraId: { not: null } },
    },
    select: {
      id: true,
      scanTime: true,
      result: true,
      device: { select: { id: true, name: true, cameraId: true } },
      ticket: { select: { name: true, ticketTypeName: true } },
    },
    orderBy: { scanTime: "desc" },
    take: 50,
  });

  return NextResponse.json(
    scans.map((s) => ({
      id: s.id,
      cameraId: s.device!.cameraId!,
      deviceName: s.device!.name,
      scanTime: s.scanTime.toISOString(),
      result: s.result,
      ticketName: s.ticket?.name ?? null,
      ticketTypeName: s.ticket?.ticketTypeName ?? null,
    })),
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
