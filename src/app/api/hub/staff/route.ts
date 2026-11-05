import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";
import { fetchStaffLive, parseMonitorUrl } from "@/lib/emp-control-live";

export const dynamic = "force-dynamic";

/**
 * GET (Hub, Token-Auth): Wer ist gerade eingestempelt, wer hat heute noch
 * Schicht – live aus emp-control (siehe src/lib/emp-control-live.ts).
 *
 * Der Monitor-Token geht nicht an den Hub; der Hub bekommt nur Namen,
 * Bereiche und Zeiten.
 *
 * 200 { configured: true, fetchedAt, working: [...], shifts: [...] }
 * 200 { configured: false, reason }   – noch kein Monitor-Link hinterlegt
 * 502 { configured: true, error }     – emp-control nicht erreichbar/abgelehnt
 */
export async function GET(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const { db, account } = auth;

  const config = await db.apiConfig.findFirst({
    where: { accountId: account.id, provider: "EMP_CONTROL" },
    select: { extraConfig: true },
  });
  let monitorUrl: unknown = null;
  try {
    monitorUrl = config?.extraConfig ? (JSON.parse(config.extraConfig) as Record<string, unknown>).monitorUrl : null;
  } catch {
    /* unlesbares JSON = nicht eingerichtet */
  }
  const link = parseMonitorUrl(monitorUrl);
  if (!link) {
    return NextResponse.json({
      configured: false,
      reason: config
        ? "In den Einstellungen bei emp-control ist kein Live-Monitor-Link hinterlegt."
        : "emp-control ist in den Einstellungen nicht eingerichtet.",
    });
  }

  try {
    const data = await fetchStaffLive(link);
    return NextResponse.json({ configured: true, ...data });
  } catch (e) {
    return NextResponse.json(
      { configured: true, error: e instanceof Error ? e.message : "emp-control nicht erreichbar" },
      { status: 502 },
    );
  }
}
