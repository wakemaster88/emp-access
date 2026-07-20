import { safeAuth } from "@/lib/auth";
import { tenantClient } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import {
  SurveillanceClient,
  type SurveillanceConfigDTO,
} from "@/components/surveillance/surveillance-client";
import { isSurveillanceArmed } from "@/lib/surveillance";

export const dynamic = "force-dynamic";

export default async function UeberwachungPage() {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");
  if (!session.user.accountId) redirect("/");

  const accountId = session.user.accountId;
  const db = tenantClient(accountId);

  const [account, cameras, config] = await Promise.all([
    db.account.findUnique({
      where: { id: accountId },
      select: { timezone: true },
    }),
    db.camera.findMany({
      where: { accountId },
      select: { id: true, name: true, enabled: true },
      orderBy: { name: "asc" },
    }),
    db.surveillanceConfig.findUnique({
      where: { accountId },
      include: { cameras: { select: { cameraId: true } } },
    }),
  ]);

  const now = new Date();
  const initial: SurveillanceConfigDTO = config
    ? {
        id: config.id,
        manualArmed: config.manualArmed,
        scheduleEnabled: config.scheduleEnabled,
        daysOfWeek: config.daysOfWeek,
        windowStart: config.windowStart,
        windowEnd: config.windowEnd,
        cooldownMinutes: config.cooldownMinutes,
        alertOnPerson: config.alertOnPerson,
        alertOnVehicle: config.alertOnVehicle,
        alertTelegram: config.alertTelegram,
        cameraIds: config.cameras.map((c) => c.cameraId),
        armedNow: isSurveillanceArmed(config, now, account?.timezone),
        updatedAt: config.updatedAt.toISOString(),
      }
    : {
        id: null,
        manualArmed: false,
        scheduleEnabled: false,
        daysOfWeek: 127,
        windowStart: "22:00",
        windowEnd: "08:00",
        cooldownMinutes: 5,
        alertOnPerson: true,
        alertOnVehicle: true,
        alertTelegram: true,
        cameraIds: cameras.filter((c) => c.enabled).map((c) => c.id),
        armedNow: false,
        updatedAt: null,
      };

  return (
    <>
      <Header title="Überwachung" accountName={session.user.accountName} />
      <div className="p-4 sm:p-6">
        <SurveillanceClient initial={initial} cameras={cameras} />
      </div>
    </>
  );
}
