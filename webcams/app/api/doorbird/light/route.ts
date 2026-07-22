import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { doorbirdLightOn } from "@/lib/doorbird";
import { logEvent } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function POST() {
  const config = await loadConfig();
  if (!config.doorbird.enabled || !config.doorbird.ip) {
    return NextResponse.json({ error: "doorbird not configured" }, { status: 400 });
  }
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 5000);
    await doorbirdLightOn(config.doorbird, ctl.signal);
    clearTimeout(t);
    await logEvent({ action: "doorbird-light", ok: true });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const e = err as Error;
    await logEvent({ action: "doorbird-light", ok: false, meta: { error: e.message } });
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}
