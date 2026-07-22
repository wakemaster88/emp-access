import { NextResponse } from "next/server";
import { z } from "zod";
import { detectLocalSubnet, scanForReolink } from "@/lib/scan";
import { loadConfig } from "@/lib/config";

import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  username: z.string().min(1).default("admin"),
  password: z.string().min(1),
  subnet: z.string().regex(/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/).optional(),
});

export async function POST(req: Request) {
  const denied = await requireAuth(req);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const subnet = parsed.data.subnet ?? detectLocalSubnet();
  if (!subnet) {
    return NextResponse.json({ error: "subnet konnte nicht erkannt werden" }, { status: 400 });
  }

  const config = await loadConfig();
  const knownIps = new Set(config.cams.map((c) => c.ip));

  try {
    const found = await scanForReolink({
      subnet,
      username: parsed.data.username,
      password: parsed.data.password,
      excludeIps: knownIps,
    });
    return NextResponse.json({
      ok: true,
      subnet,
      found,
      knownCount: knownIps.size,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message, subnet },
      { status: 500 },
    );
  }
}
