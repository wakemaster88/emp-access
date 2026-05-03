import { safeAuth } from "@/lib/auth";
import { tenantClient, superAdminClient } from "@/lib/prisma";
import type { PrismaClient } from "@prisma/client";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { SubscriptionsTable } from "@/components/subscriptions/subscriptions-table";
import { ExpiringAbosCard } from "@/components/subscriptions/expiring-abos-card";
import { SubscriptionStats } from "@/components/subscriptions/subscription-stats";
import { computeSubscriptionStats } from "@/lib/subscription-stats";

interface AnnyExtra {
  services?: string[];
  resources?: string[];
  subscriptions?: string[];
}

export default async function SubscriptionsPage() {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");

  const isSuperAdmin = session.user.role === "SUPER_ADMIN";
  const db = isSuperAdmin ? superAdminClient : tenantClient(session.user.accountId!);
  const accountFilter = isSuperAdmin ? {} : { accountId: session.user.accountId! };

  const [subscriptions, areas, annyConfig, expiringAboTickets, stats] = await Promise.all([
    db.subscription.findMany({
      where: accountFilter,
      include: {
        areas: { select: { id: true, name: true } },
        _count: { select: { tickets: true } },
        tickets: {
          select: {
            id: true,
            name: true,
            firstName: true,
            lastName: true,
            startDate: true,
            endDate: true,
            status: true,
            ticketTypeName: true,
            rfidCode: true,
            barcode: true,
          },
          orderBy: { name: "asc" },
        },
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
    db.ticket.findMany({
      where: {
        ...accountFilter,
        subscriptionId: { not: null },
        endDate: { not: null, gt: new Date() },
        status: { in: ["VALID", "REDEEMED", "PAUSED"] },
      },
      select: {
        id: true,
        name: true,
        firstName: true,
        lastName: true,
        endDate: true,
        status: true,
        ticketTypeName: true,
        barcode: true,
        qrCode: true,
        rfidCode: true,
        subscription: { select: { id: true, name: true } },
      },
      orderBy: { endDate: "asc" },
      take: 10,
    }),
    isSuperAdmin
      ? Promise.resolve(null)
      : computeSubscriptionStats(db as unknown as PrismaClient, session.user.accountId!, 365),
  ]);

  let annyServices: string[] = [];
  let annyResources: string[] = [];
  let annySubscriptions: string[] = [];
  if (annyConfig?.extraConfig) {
    try {
      const parsed: AnnyExtra = JSON.parse(annyConfig.extraConfig);
      annyServices = (parsed.services || []).sort();
      annyResources = (parsed.resources || []).sort();
      annySubscriptions = (parsed.subscriptions || []).sort();
    } catch { /* ignore */ }
  }

  return (
    <>
      <Header title="Abos" accountName={session.user.accountName} />
      <div className="p-4 sm:p-6">
        {stats && <SubscriptionStats stats={stats} />}
        <ExpiringAbosCard tickets={expiringAboTickets} readonly={isSuperAdmin} />
        <Card className="border-slate-200 dark:border-slate-800">
          <CardHeader className="pb-4">
            <CardTitle className="text-base sm:text-xl">Alle Abos ({subscriptions.length})</CardTitle>
            <CardDescription>
              Abos verknüpfen <Link href="/tickets" className="text-indigo-600 dark:text-indigo-400 hover:underline">Tickets</Link> mit <Link href="/areas" className="text-indigo-600 dark:text-indigo-400 hover:underline">Resourcen</Link> und definieren Standard-Gültigkeiten.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SubscriptionsTable
              subscriptions={subscriptions}
              areas={areas}
              annyServices={isSuperAdmin ? [] : annyServices}
              annyResources={isSuperAdmin ? [] : annyResources}
              annySubscriptions={isSuperAdmin ? [] : annySubscriptions}
              readonly={isSuperAdmin}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
