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
  dayServiceIds: z.array(z.number().int()).max(200).default([]),
  /** Preise in Cent für den Abo-Rechner, Schlüssel ist die ID als Text. */
  servicePrices: z.record(z.string().regex(/^\d+$/), z.number().int().min(1).max(10_000_00)).default({}),
  subscriptionPrices: z.record(z.string().regex(/^\d+$/), z.number().int().min(1).max(10_000_00)).default({}),
  /** Fühler für die Wassertemperatur; fehlt der Wert, bleibt die Wahl, wie sie ist. */
  waterSensorDeviceId: z.number().int().positive().nullable().optional(),
});

/** Nur Preise zu IDs behalten, die zum Konto gehören und gewählt sind. */
function pickPrices(prices: Record<string, number>, ids: number[]): Record<string, number> {
  return Object.fromEntries(Object.entries(prices).filter(([id]) => ids.includes(Number(id))));
}

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

  const dayServiceIds = cleanIds(parsed.data.dayServiceIds);

  const waterSensorDeviceId = parsed.data.waterSensorDeviceId;

  const refError = await foreignRefError(db, accountId, {
    subscriptionIds,
    deviceIds: waterSensorDeviceId != null ? [...startDeviceIds, waterSensorDeviceId] : startDeviceIds,
    serviceIds: dayServiceIds,
  });
  if (refError) return NextResponse.json({ error: refError }, { status: 400 });

  const data = {
    enabled: parsed.data.enabled,
    subscriptionIds,
    startCapPerDay: parsed.data.startCapPerDay,
    dayServiceIds,
    servicePrices: pickPrices(parsed.data.servicePrices, dayServiceIds),
    subscriptionPrices: pickPrices(parsed.data.subscriptionPrices, subscriptionIds),
    ...(waterSensorDeviceId !== undefined && { waterSensorDeviceId }),
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
