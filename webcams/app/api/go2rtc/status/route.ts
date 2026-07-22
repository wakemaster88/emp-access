import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { checkGo2rtcReachable } from "@/lib/go2rtc";

export const dynamic = "force-dynamic";

/**
 * Leichtgewichtiger Health-Check für das Dashboard-Banner.
 * Kein Auth, kein YAML-Schreiben — nur „ist go2rtc erreichbar?".
 */
export async function GET() {
  const config = await loadConfig();
  const result = await checkGo2rtcReachable(config.settings.go2rtcUrl);
  return NextResponse.json(result);
}
