/**
 * Taste „Audio“ am Check-in-Monitor: die Zone, die dieser Monitor abspielt,
 * ansehen und steuern – von jedem Gerät mit dem Link, nicht nur von dem, das
 * gerade spielt.
 *
 * GET  – `{ zone: MonitorAudioControlView | null }`; null = Monitor spielt keine Zone.
 * POST – `{ action: "PLAY" | "STOP" | "MUTE" | "UNMUTE" }` oder
 *        `{ action: "VOLUME", volume: 0–100 }`. Antwort wie GET.
 *
 * Start/Stopp/Lautstärke gehen als Befehl an den Abspieler (wie im Dashboard),
 * Stumm steht an der Zone und kommt mit dem nächsten Abruf an. Zugang über
 * den Link-Token des Monitors, wie die übrigen Monitor-Endpunkte.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma, tenantClient } from "@/lib/prisma";
import { publicLinkRateLimit } from "@/lib/rate-limit";
import { isMonitorAudioType } from "@/lib/audio-constants";
import { parseControlAction } from "@/lib/monitor-audio";
import { monitorControlView, monitorControlZoneSelect, runMonitorControl } from "@/lib/monitor-audio-control";

export const maxDuration = 10;

/** Offenes Blatt fragt alle 3 s, die Taste im Kopf selten; Luft für mehrere Geräte hinter einer IP. */
const READ_LIMIT = { limit: 90, windowMs: 60_000 } as const;
const WRITE_LIMIT = { limit: 30, windowMs: 60_000 } as const;

async function findZone(token: string) {
  const monitor = await prisma.monitorConfig.findUnique({
    where: { token },
    select: { id: true, accountId: true, isActive: true, type: true },
  });
  if (!monitor || !monitor.isActive || !isMonitorAudioType(monitor.type)) return null;
  const db = tenantClient(monitor.accountId);
  const zone = await db.audioZone.findFirst({
    where: { monitorId: monitor.id },
    select: monitorControlZoneSelect,
  });
  return { monitor, db, zone };
}

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const limited = publicLinkRateLimit(request, token, "monitor-audio-control", READ_LIMIT);
  if (limited) return limited;

  const found = await findZone(token);
  if (!found) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  return NextResponse.json(
    { zone: found.zone ? monitorControlView(found.zone) : null },
    { headers: NO_STORE }
  );
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const limited = publicLinkRateLimit(request, token, "monitor-audio-control-write", WRITE_LIMIT);
  if (limited) return limited;

  const input = parseControlAction(await request.json().catch(() => null));
  if (!input) return NextResponse.json({ error: "Unbekannter Befehl" }, { status: 400 });

  const found = await findZone(token);
  if (!found) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
  if (!found.zone) return NextResponse.json({ error: "Dieser Monitor spielt keine Audio-Zone" }, { status: 404 });

  const result = await runMonitorControl(found.db, found.monitor.accountId, found.zone, input);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  const zone = await found.db.audioZone.findFirst({
    where: { id: found.zone.id },
    select: monitorControlZoneSelect,
  });
  return NextResponse.json({ zone: zone ? monitorControlView(zone) : null }, { headers: NO_STORE });
}
