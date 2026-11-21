import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { publicRateLimit } from "@/lib/rate-limit";
import { riderApiManage } from "@/lib/rider-auth";
import { setBirthdayAnnounce } from "@/lib/rider-birthday";

const schema = z.object({ announce: z.boolean() });

/** PATCH: Geburtstags-Durchsage am Lift für diese Person ab- oder wieder einschalten (selbst oder Eltern). */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const limited = publicRateLimit(token, "rider-birthday", { limit: 20, windowMs: 60_000 });
  if (limited) return limited;
  const ctx = await riderApiManage(token);
  if ("error" in ctx) return ctx.error;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });
  await setBirthdayAnnounce(ctx.profile.id, parsed.data.announce);
  return NextResponse.json({ ok: true });
}
