import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { doorbirdInfo } from "@/lib/doorbird";
import { publishRing } from "@/lib/event-bus";
import { logEvent } from "@/lib/audit";
import { requireSameOrigin } from "@/lib/same-origin";

export const dynamic = "force-dynamic";

/**
 * `?action=info` → Verbindungstest gegen Doorbird (info.cgi).
 * `?action=ring` → simuliert eine Klingel (lokal, nur Anzeige: das
 *                  Ring-Fenster fürs Tür-Öffnen geht dabei nicht auf).
 */
export async function POST(req: Request) {
  const crossOrigin = requireSameOrigin(req);
  if (crossOrigin) return crossOrigin;

  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "info";
  const config = await loadConfig();

  if (action === "ring") {
    // Test-Klingel zeigt nur das Overlay — sie öffnet kein Ring-Fenster.
    const accepted = publishRing({ test: true }, { test: true });
    await logEvent({ action: "doorbird-ring", ok: true, meta: { test: true } });
    return NextResponse.json({ ok: true, accepted });
  }

  if (!config.doorbird.ip) {
    return NextResponse.json({ ok: false, error: "Keine Doorbird-IP konfiguriert" });
  }
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    const info = await doorbirdInfo(config.doorbird, ctl.signal);
    clearTimeout(t);
    return NextResponse.json({ ok: true, info });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message });
  }
}
