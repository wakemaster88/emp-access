import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { surveillanceUpdateSchema } from "@/lib/validators";
import { isSurveillanceArmed } from "@/lib/surveillance";
import { prisma } from "@/lib/prisma";

async function loadConfig(accountId: number) {
  return prisma.surveillanceConfig.findUnique({
    where: { accountId },
    include: {
      cameras: {
        select: { cameraId: true, camera: { select: { id: true, name: true, enabled: true } } },
      },
    },
  });
}

function serialize(
  config: NonNullable<Awaited<ReturnType<typeof loadConfig>>>,
  timezone: string | null | undefined
) {
  const now = new Date();
  const cameraIds = config.cameras.map((c) => c.cameraId);
  return {
    id: config.id,
    manualArmed: config.manualArmed,
    scheduleEnabled: config.scheduleEnabled,
    daysOfWeek: config.daysOfWeek,
    windowStart: config.windowStart,
    windowEnd: config.windowEnd,
    cooldownMinutes: config.cooldownMinutes,
    alertOnPerson: config.alertOnPerson,
    alertOnVehicle: config.alertOnVehicle,
    cameraIds,
    cameras: config.cameras.map((c) => c.camera),
    armedNow: isSurveillanceArmed(config, now, timezone),
    updatedAt: config.updatedAt.toISOString(),
  };
}

/** GET (Session): Überwachungs-Config inkl. effektivem Scharf-Status. */
export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { accountId } = session;

  const [account, config] = await Promise.all([
    prisma.account.findUnique({
      where: { id: accountId! },
      select: { timezone: true },
    }),
    loadConfig(accountId!),
  ]);

  if (!config) {
    return NextResponse.json({
      id: null,
      manualArmed: false,
      scheduleEnabled: false,
      daysOfWeek: 127,
      windowStart: "22:00",
      windowEnd: "08:00",
      cooldownMinutes: 5,
      alertOnPerson: true,
      alertOnVehicle: true,
      cameraIds: [] as number[],
      cameras: [],
      armedNow: false,
      updatedAt: null,
    });
  }

  return NextResponse.json(serialize(config, account?.timezone));
}

/** PATCH (Session): Überwachungs-Config speichern / anlegen. */
export async function PATCH(request: NextRequest) {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { accountId } = session;

  const body = await request.json().catch(() => null);
  const parsed = surveillanceUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;
  if (
    data.scheduleEnabled &&
    data.windowStart !== undefined &&
    data.windowEnd !== undefined &&
    ((data.windowStart && !data.windowEnd) || (!data.windowStart && data.windowEnd))
  ) {
    return NextResponse.json(
      { error: "windowStart und windowEnd müssen beide gesetzt oder beide leer sein" },
      { status: 400 }
    );
  }

  let cameraIds = data.cameraIds;
  if (cameraIds) {
    const cams = await prisma.camera.findMany({
      where: { accountId: accountId!, id: { in: cameraIds } },
      select: { id: true },
    });
    const ok = new Set(cams.map((c) => c.id));
    cameraIds = cameraIds.filter((id) => ok.has(id));
  }

  const existing = await prisma.surveillanceConfig.findUnique({
    where: { accountId: accountId! },
    select: { id: true },
  });

  const config = await prisma.$transaction(async (tx) => {
    const base = {
      ...(data.manualArmed !== undefined ? { manualArmed: data.manualArmed } : {}),
      ...(data.scheduleEnabled !== undefined ? { scheduleEnabled: data.scheduleEnabled } : {}),
      ...(data.daysOfWeek !== undefined ? { daysOfWeek: data.daysOfWeek } : {}),
      ...(data.windowStart !== undefined ? { windowStart: data.windowStart } : {}),
      ...(data.windowEnd !== undefined ? { windowEnd: data.windowEnd } : {}),
      ...(data.cooldownMinutes !== undefined ? { cooldownMinutes: data.cooldownMinutes } : {}),
      ...(data.alertOnPerson !== undefined ? { alertOnPerson: data.alertOnPerson } : {}),
      ...(data.alertOnVehicle !== undefined ? { alertOnVehicle: data.alertOnVehicle } : {}),
    };

    const row = existing
      ? await tx.surveillanceConfig.update({
          where: { id: existing.id },
          data: base,
        })
      : await tx.surveillanceConfig.create({
          data: {
            accountId: accountId!,
            windowStart: data.windowStart ?? "22:00",
            windowEnd: data.windowEnd ?? "08:00",
            ...base,
          },
        });

    if (cameraIds) {
      await tx.surveillanceCamera.deleteMany({ where: { configId: row.id } });
      if (cameraIds.length > 0) {
        await tx.surveillanceCamera.createMany({
          data: cameraIds.map((cameraId) => ({ configId: row.id, cameraId })),
        });
      }
    } else if (!existing) {
      // Erste Anlage ohne cameraIds: alle aktivierten Kameras.
      const all = await tx.camera.findMany({
        where: { accountId: accountId!, enabled: true },
        select: { id: true },
      });
      if (all.length > 0) {
        await tx.surveillanceCamera.createMany({
          data: all.map((c) => ({ configId: row.id, cameraId: c.id })),
        });
      }
    }

    return row;
  });

  const [account, full] = await Promise.all([
    prisma.account.findUnique({
      where: { id: accountId! },
      select: { timezone: true },
    }),
    loadConfig(accountId!),
  ]);

  if (!full) {
    return NextResponse.json({ error: "Config nicht geladen" }, { status: 500 });
  }
  return NextResponse.json(serialize(full, account?.timezone));
}
