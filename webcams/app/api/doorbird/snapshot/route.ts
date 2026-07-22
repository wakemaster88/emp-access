import { loadConfig } from "@/lib/config";
import { doorbirdSnapshot } from "@/lib/doorbird";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = await loadConfig();
  if (!config.doorbird.enabled || !config.doorbird.ip) {
    return new Response("doorbird not configured", { status: 400 });
  }
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 5000);
    const buf = await doorbirdSnapshot(config.doorbird, ctl.signal);
    clearTimeout(t);
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return new Response((err as Error).message, { status: 502 });
  }
}
