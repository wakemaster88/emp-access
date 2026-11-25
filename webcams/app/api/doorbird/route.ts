import { NextResponse } from "next/server";
import { loadConfig, saveConfig } from "@/lib/config";
import { DoorbirdSchema } from "@/lib/types";
import { writeGo2rtcYaml, reloadGo2rtc } from "@/lib/go2rtc";
import { doorbirdWriteErrors } from "@/lib/config-validate";
import { requireSameOriginJson } from "@/lib/same-origin";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = await loadConfig();
  return NextResponse.json({
    ...config.doorbird,
    password: config.doorbird.password ? "***" : "",
    webhookSecret: config.doorbird.webhookSecret ? "***" : "",
  });
}

export async function PUT(req: Request) {
  const rejected = requireSameOriginJson(req);
  if (rejected) return rejected;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = DoorbirdSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const config = await loadConfig();
  const incoming = parsed.data;
  const invalid = doorbirdWriteErrors(incoming, config.doorbird);
  if (invalid.length) {
    return NextResponse.json({ error: invalid.join("; ") }, { status: 400 });
  }
  if (incoming.password === "***") incoming.password = config.doorbird.password;
  if (incoming.webhookSecret === "***") incoming.webhookSecret = config.doorbird.webhookSecret;

  const next = { ...config, doorbird: incoming };
  await saveConfig(next);
  await writeGo2rtcYaml(next);
  await reloadGo2rtc(next.settings.go2rtcUrl);
  return NextResponse.json({ ok: true });
}
