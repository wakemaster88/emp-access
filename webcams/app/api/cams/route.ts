import { NextResponse } from "next/server";
import { loadConfig, saveConfig } from "@/lib/config";
import { CamSchema } from "@/lib/types";
import { writeGo2rtcYaml, reloadGo2rtc } from "@/lib/go2rtc";
import { syncWorkers } from "@/lib/people-counter";
import { notifySidecarConfigChanged } from "@/lib/people-tracker";
import { prepareCamForSave } from "@/lib/cam-helpers";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = await loadConfig();
  return NextResponse.json(
    config.cams.map((c) => ({ ...c, password: c.password ? "***" : "" })),
  );
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = CamSchema.safeParse(prepareCamForSave(body, null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const config = await loadConfig();
  if (config.cams.some((c) => c.id === parsed.data.id)) {
    return NextResponse.json(
      { error: `cam id "${parsed.data.id}" existiert bereits` },
      { status: 409 },
    );
  }
  const next = { ...config, cams: [...config.cams, parsed.data] };
  await saveConfig(next);
  await writeGo2rtcYaml(next);
  await reloadGo2rtc(next.settings.go2rtcUrl);
  await syncWorkers();
  void notifySidecarConfigChanged();
  return NextResponse.json({ ok: true, cam: { ...parsed.data, password: "***" } });
}
