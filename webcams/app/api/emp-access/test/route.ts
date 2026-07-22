import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import {
  EmpAccessHttpError,
  empAccessGetJson,
  extractDevicesArray,
} from "@/lib/emp-access-client";

export const dynamic = "force-dynamic";

/** GET/POST: Prüft ob Base-URL + Token `/api/devices` lesen können. */
export async function GET() {
  return handle();
}

export async function POST() {
  return handle();
}

async function handle() {
  const config = await loadConfig();
  const ea = config.settings.empAccess;
  if (!ea.apiToken?.trim()) {
    return NextResponse.json(
      { ok: false, error: "Kein API-Token konfiguriert" },
      { status: 400 },
    );
  }
  const base = ea.baseUrl.trim() || "https://emp-access.de";
  try {
    const raw = await empAccessGetJson(
      base,
      ea.apiToken.trim(),
      "/api/devices",
    );
    const devices = extractDevicesArray(raw);
    return NextResponse.json({
      ok: true,
      baseUrl: base,
      deviceCount: devices.length,
    });
  } catch (e) {
    const msg =
      e instanceof EmpAccessHttpError
        ? `${e.message}: ${e.bodySnippet}`
        : (e as Error).message;
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
