import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { gamiAdminSession } from "@/lib/gamification-session";
import { invalidateGamiConfig } from "@/lib/gamification-service";
import { cleanIds, foreignRefError } from "@/lib/tenant-refs";

const schema = z.object({
  enabled: z.boolean(),
  subscriptionIds: z.array(z.number().int()).max(100),
  startCapPerDay: z.number().int().min(1).max(100),
  startDeviceIds: z.array(z.number().int()).max(100),
});

/** PUT: Gamification-Einstellungen und Start-Geräte speichern. */
export async function PUT(request: NextRequest) {
  const session = await gamiAdminSession();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });
  }
  const subscriptionIds = cleanIds(parsed.data.subscriptionIds);
  const startDeviceIds = cleanIds(parsed.data.startDeviceIds);

  const refError = await foreignRefError(db, accountId, { subscriptionIds, deviceIds: startDeviceIds });
  if (refError) return NextResponse.json({ error: refError }, { status: 400 });

  const data = {
    enabled: parsed.data.enabled,
    subscriptionIds,
    startCapPerDay: parsed.data.startCapPerDay,
  };
  await db.$transaction([
    db.gamificationConfig.upsert({
      where: { accountId },
      create: { ...data, accountId },
      update: data,
    }),
    db.device.updateMany({
      where: { accountId, countsAsStart: true, id: { notIn: startDeviceIds } },
      data: { countsAsStart: false },
    }),
    db.device.updateMany({
      where: { accountId, id: { in: startDeviceIds } },
      data: { countsAsStart: true },
    }),
  ]);
  invalidateGamiConfig(accountId);

  return NextResponse.json({ ok: true });
}
