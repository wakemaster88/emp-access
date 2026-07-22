import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { writeGo2rtcYaml, reloadGo2rtc, getGo2rtcYamlPath, checkGo2rtcReachable } from "@/lib/go2rtc";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = await requireAuth(req);
  if (denied) return denied;

  const config = await loadConfig();
  const yamlPath = await writeGo2rtcYaml(config);
  const reloaded = await reloadGo2rtc(config.settings.go2rtcUrl);
  return NextResponse.json({ ok: true, yamlPath: getGo2rtcYamlPath(), wrote: yamlPath, reloaded });
}

export async function GET() {
  const config = await loadConfig();
  const result = await checkGo2rtcReachable(config.settings.go2rtcUrl);
  return NextResponse.json(result);
}
