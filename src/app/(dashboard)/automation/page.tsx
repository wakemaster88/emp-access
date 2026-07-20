import { safeAuth } from "@/lib/auth";
import { tenantClient } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { AutomationClient } from "@/components/automation/automation-client";

export const dynamic = "force-dynamic";

export default async function AutomationPage() {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");
  if (!session.user.accountId) redirect("/");

  const db = tenantClient(session.user.accountId);

  const [groups, automations, shellyDevices, recentRuns, account, cameras] = await Promise.all([
    db.shellyGroup.findMany({
      where: { accountId: session.user.accountId },
      include: {
        members: {
          include: { device: { select: { id: true, name: true, category: true } } },
          orderBy: { sortOrder: "asc" },
        },
        _count: { select: { automations: true } },
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    db.shellyAutomation.findMany({
      where: { accountId: session.user.accountId },
      include: {
        group: { select: { id: true, name: true } },
        camera: { select: { id: true, name: true } },
      },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    }),
    db.device.findMany({
      where: { accountId: session.user.accountId, type: "SHELLY" },
      select: { id: true, name: true, category: true },
      orderBy: { name: "asc" },
    }),
    db.shellyAutomationRun.findMany({
      where: { accountId: session.user.accountId },
      orderBy: { triggeredAt: "desc" },
      take: 50,
      include: { automation: { select: { id: true, name: true } } },
    }),
    db.account.findUnique({
      where: { id: session.user.accountId },
      select: { latitude: true, longitude: true, timezone: true },
    }),
    db.camera.findMany({
      where: { accountId: session.user.accountId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <>
      <Header title="Automation" accountName={session.user.accountName} />
      <div className="p-4 sm:p-6">
        <AutomationClient
          initialGroups={groups}
          initialAutomations={automations}
          shellyDevices={shellyDevices}
          initialRuns={recentRuns}
          account={account ?? { latitude: null, longitude: null, timezone: null }}
          cameras={cameras}
        />
      </div>
    </>
  );
}
