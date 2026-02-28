import { safeAuth } from "@/lib/auth";
import { tenantClient, superAdminClient } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ServicesTable } from "@/components/services/services-table";

interface AnnyExtra {
  services?: string[];
  resources?: string[];
  subscriptions?: string[];
}

export default async function ServicesPage() {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");

  const isSuperAdmin = session.user.role === "SUPER_ADMIN";
  const db = isSuperAdmin ? superAdminClient : tenantClient(session.user.accountId!);
  const accountFilter = isSuperAdmin ? {} : { accountId: session.user.accountId! };

  const [services, areas, annyConfig] = await Promise.all([
    db.service.findMany({
      where: accountFilter,
      include: {
        serviceAreas: { include: { area: { select: { id: true, name: true } } } },
        _count: { select: { tickets: true } },
      },
      orderBy: { name: "asc" },
    }),
    db.accessArea.findMany({
      where: accountFilter,
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.apiConfig.findFirst({
      where: { ...accountFilter, provider: "ANNY" },
      select: { extraConfig: true },
    }).catch(() => null),
  ]);

  let annyServices: string[] = [];
  let annyResources: string[] = [];
  if (annyConfig?.extraConfig) {
    try {
      const parsed: AnnyExtra = JSON.parse(annyConfig.extraConfig);
      annyServices = (parsed.services || []).sort();
      annyResources = (parsed.resources || []).sort();
    } catch { /* ignore */ }
  }

  return (
    <>
      <Header title="Services" accountName={session.user.accountName} />
      <div className="p-4 sm:p-6">
        <Card className="border-slate-200 dark:border-slate-800">
          <CardHeader className="pb-4">
            <CardTitle className="text-base sm:text-xl">Alle Services ({services.length})</CardTitle>
            <CardDescription>
              Services gruppieren <Link href="/tickets" className="text-indigo-600 dark:text-indigo-400 hover:underline">Tickets</Link> und verknüpfen sie mit <Link href="/areas" className="text-indigo-600 dark:text-indigo-400 hover:underline">Resourcen</Link> (Zugangsbereichen).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ServicesTable
              services={services}
              areas={areas}
              annyServices={isSuperAdmin ? [] : annyServices}
              annyResources={isSuperAdmin ? [] : annyResources}
              readonly={isSuperAdmin}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
