import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { publicLinkRateLimit, publicRateLimit } from "@/lib/rate-limit";
import { syncAnnyForAccount } from "@/lib/anny-sync";

// Fensterlauf, angestossen ueber den Checkin-Monitor. Bewusst niedriger als der
// Cron (300s): der Endpoint haengt nur an einem Monitor-Token, soll also nicht
// beliebig lange Funktionslaufzeit binden koennen.
export const maxDuration = 120;

/**
 * Der Abgleich wird von Hand am Kiosk angestossen und laeuft bis zu zwei
 * Minuten. Die Grenze bremst Schleifen, nicht das Personal (mehrere Kioske
 * mit demselben Link teilen sich eine IP).
 */
const ANNY_SYNC_LIMIT = { limit: 10, windowMs: 10 * 60_000 } as const;
/**
 * Dazu hoechstens zwei Anstoesse je Minute und Link, ueber alle Anschluesse
 * zusammen: die Taste wartet ohnehin auf den Lauf.
 */
const ANNY_SYNC_BURST_LIMIT = { limit: 2, windowMs: 60_000 } as const;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const limited =
    publicRateLimit(token, "checkin-anny-sync-burst", ANNY_SYNC_BURST_LIMIT) ??
    publicLinkRateLimit(request, token, "checkin-anny-sync", ANNY_SYNC_LIMIT);
  if (limited) return limited;
  const monitor = await prisma.monitorConfig.findUnique({ where: { token } });
  if (!monitor || !monitor.isActive || monitor.type !== "CHECKIN") {
    return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  }

  const annyConfig = await prisma.apiConfig.findFirst({
    where: { accountId: monitor.accountId, provider: "ANNY" },
    select: { id: true },
  });
  if (!annyConfig) {
    return NextResponse.json({ error: "Keine ANNY-Integration konfiguriert" }, { status: 404 });
  }

  try {
    // Am Einlass zaehlt Geschwindigkeit: nur heutige/kuenftige Buchungen.
    const result = await syncAnnyForAccount(monitor.accountId, { mode: "incremental" });
    return NextResponse.json({
      ok: true,
      mode: result.mode,
      created: result.created,
      updated: result.updated,
      errors: result.errors,
      errorDetails: result.errorDetails,
      total: result.total,
      // Lief schon ein Abgleich, kommt dieselbe Erfolgsantwort mit Marker.
      ...(result.alreadyRunning ? { alreadyRunning: true } : {}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
