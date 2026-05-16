import { safeAuth } from "@/lib/auth";
import { tenantClient } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { EmployeesClient } from "@/components/employees/employees-client";

export default async function EmployeesPage() {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");
  if (!session.user.accountId) redirect("/");

  const db = tenantClient(session.user.accountId);

  const [areas, devices, empControlConfig] = await Promise.all([
    db.accessArea.findMany({
      where: { accountId: session.user.accountId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, parentId: true },
    }),
    db.device.findMany({
      where: { accountId: session.user.accountId, isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        type: true,
        category: true,
      },
    }),
    db.apiConfig.findFirst({
      where: { accountId: session.user.accountId, provider: "EMP_CONTROL" },
      select: { lastUpdate: true },
    }),
  ]);

  return (
    <>
      <Header title="Mitarbeiter" accountName={session.user.accountName} />
      <div className="p-4 sm:p-6">
        <EmployeesClient
          areas={areas}
          devices={devices}
          empControlLastSync={empControlConfig?.lastUpdate ?? null}
        />
      </div>
    </>
  );
}
