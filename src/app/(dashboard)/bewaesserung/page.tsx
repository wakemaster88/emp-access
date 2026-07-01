import { safeAuth } from "@/lib/auth";
import { tenantClient } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { getWeather } from "@/lib/weather";
import { getIrrigationRecommendation } from "@/lib/irrigation";
import { IrrigationClient } from "@/components/irrigation/irrigation-client";

export const dynamic = "force-dynamic";

export default async function BewaesserungPage() {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");
  if (!session.user.accountId) redirect("/");

  const accountId = session.user.accountId;
  const db = tenantClient(accountId);

  const [zones, schedules, gardenaConfig, account] = await Promise.all([
    db.device.findMany({
      where: { accountId, type: "GARDENA_VALVE" },
      select: { id: true, name: true, gardenaServiceId: true, isActive: true, pumpDeviceId: true },
      orderBy: { name: "asc" },
    }),
    db.irrigationSchedule.findMany({
      where: { accountId },
      include: { device: { select: { id: true, name: true } } },
      orderBy: [{ startTime: "asc" }],
    }),
    db.apiConfig.findFirst({ where: { accountId, provider: "GARDENA" } }),
    db.account.findUnique({
      where: { id: accountId },
      select: { latitude: true, longitude: true },
    }),
  ]);

  const weather = await getWeather(account?.latitude ?? null, account?.longitude ?? null);
  const recommendation = getIrrigationRecommendation(weather);

  return (
    <>
      <Header title="Bewässerung" accountName={session.user.accountName} />
      <IrrigationClient
        connected={!!gardenaConfig?.token && !!gardenaConfig?.extraConfig}
        zones={zones.map((z) => ({
          id: z.id,
          name: z.name,
          serviceId: z.gardenaServiceId,
          isActive: z.isActive,
          pumpDeviceId: z.pumpDeviceId,
        }))}
        schedules={schedules.map((s) => ({
          id: s.id,
          deviceId: s.deviceId,
          deviceName: s.device?.name ?? "Zone",
          daysOfWeek: s.daysOfWeek,
          startTime: s.startTime,
          durationMinutes: s.durationMinutes,
          isActive: s.isActive,
          skipOnRain: s.skipOnRain,
          lastRunAt: s.lastRunAt ? s.lastRunAt.toISOString() : null,
        }))}
        weather={weather}
        recommendation={recommendation}
      />
    </>
  );
}
