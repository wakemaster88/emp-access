import { safeAuth } from "@/lib/auth";
import { tenantClient, superAdminClient } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { VouchersTable } from "@/components/vouchers/vouchers-table";
import { Gift, Check, Clock, Ban } from "lucide-react";

interface Props {
  searchParams: Promise<{
    status?: string;
    q?: string;
    sort?: string;
    order?: string;
  }>;
}

export default async function VouchersPage({ searchParams }: Props) {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");

  const {
    status = "all",
    q = "",
    sort = "createdAt",
    order = "desc",
  } = await searchParams;

  const isSuperAdmin = session.user.role === "SUPER_ADMIN";
  const db = isSuperAdmin ? superAdminClient : tenantClient(session.user.accountId!);

  const baseWhere = isSuperAdmin ? {} : { accountId: session.user.accountId! };

  const statusFilter = (() => {
    if (status === "redeemed") return { redeemedAt: { not: null } };
    if (status === "open") {
      return { redeemedAt: null, disabledAt: null };
    }
    if (status === "expired") {
      return {
        redeemedAt: null,
        disabledAt: null,
        expiresAt: { lt: new Date() },
      };
    }
    if (status === "disabled") return { disabledAt: { not: null } };
    return {};
  })();

  const queryTrim = q.trim();
  const queryFilter = queryTrim
    ? {
        OR: [
          { code: { contains: queryTrim, mode: "insensitive" as const } },
          { ticketTypeName: { contains: queryTrim, mode: "insensitive" as const } },
          { notes: { contains: queryTrim, mode: "insensitive" as const } },
        ],
      }
    : {};

  const orderDir = order === "asc" ? ("asc" as const) : ("desc" as const);
  const orderBy = (() => {
    switch (sort) {
      case "code":
        return { code: orderDir };
      case "ticketType":
        return { ticketTypeName: orderDir };
      case "redeemedAt":
        return { redeemedAt: orderDir };
      case "expiresAt":
        return { expiresAt: orderDir };
      case "createdAt":
      default:
        return { createdAt: orderDir };
    }
  })();

  const [vouchers, totals, services, accessAreas] = await Promise.all([
    db.voucher.findMany({
      where: { ...baseWhere, ...statusFilter, ...queryFilter },
      orderBy,
      take: 1000,
    }),
    Promise.all([
      db.voucher.count({ where: baseWhere }),
      db.voucher.count({ where: { ...baseWhere, redeemedAt: { not: null } } }),
      db.voucher.count({
        where: { ...baseWhere, redeemedAt: null, disabledAt: null },
      }),
      db.voucher.count({
        where: {
          ...baseWhere,
          redeemedAt: null,
          disabledAt: null,
          expiresAt: { lt: new Date() },
        },
      }),
      db.voucher.count({
        where: { ...baseWhere, disabledAt: { not: null } },
      }),
    ]),
    db.service.findMany({
      where: baseWhere,
      select: { id: true, name: true },
    }),
    db.accessArea.findMany({
      where: baseWhere,
      select: { id: true, name: true },
    }),
  ]);

  const [totalAll, totalRedeemed, totalOpen, totalExpired, totalDisabled] = totals;

  const serviceMap = new Map(services.map((s) => [s.id, s.name]));
  const areaMap = new Map(accessAreas.map((a) => [a.id, a.name]));

  const enrichedVouchers = vouchers.map((v) => ({
    id: v.id,
    code: v.code,
    ticketTypeName: v.ticketTypeName,
    serviceId: v.serviceId,
    serviceName: v.serviceId ? serviceMap.get(v.serviceId) ?? null : null,
    accessAreaId: v.accessAreaId,
    accessAreaName: v.accessAreaId ? areaMap.get(v.accessAreaId) ?? null : null,
    discountPercent: v.discountPercent,
    validityType: v.validityType,
    validityDurationMinutes: v.validityDurationMinutes,
    createdAt: v.createdAt.toISOString(),
    redeemedAt: v.redeemedAt ? v.redeemedAt.toISOString() : null,
    expiresAt: v.expiresAt ? v.expiresAt.toISOString() : null,
    disabledAt: v.disabledAt ? v.disabledAt.toISOString() : null,
    notes: v.notes,
    sourceTicketId: v.sourceTicketId,
    redeemedTicketId: v.redeemedTicketId,
  }));

  const tabs: Array<{ id: string; label: string; count: number; icon: React.ComponentType<{ className?: string }> }> = [
    { id: "all", label: "Alle", count: totalAll, icon: Gift },
    { id: "open", label: "Offen", count: totalOpen, icon: Clock },
    { id: "redeemed", label: "Eingelöst", count: totalRedeemed, icon: Check },
    { id: "expired", label: "Abgelaufen", count: totalExpired, icon: Clock },
    { id: "disabled", label: "Deaktiviert", count: totalDisabled, icon: Ban },
  ];

  return (
    <>
      <Header title="Gutscheine" accountName={session.user.accountName} />
      <div className="p-4 sm:p-6 space-y-4">
        <Card className="border-slate-200 dark:border-slate-800">
          <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <CardTitle className="text-base sm:text-lg flex items-center gap-2">
                <Gift className="h-5 w-5 text-indigo-500" />
                Gutscheine ({enrichedVouchers.length})
              </CardTitle>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {tabs.map((tab) => {
                const isActive = (status ?? "all") === tab.id;
                const Icon = tab.icon;
                const params = new URLSearchParams();
                if (tab.id !== "all") params.set("status", tab.id);
                if (queryTrim) params.set("q", queryTrim);
                if (sort !== "createdAt") params.set("sort", sort);
                if (order !== "desc") params.set("order", order);
                const href = params.toString()
                  ? `/vouchers?${params.toString()}`
                  : "/vouchers";
                return (
                  <Button
                    key={tab.id}
                    asChild
                    variant={isActive ? "default" : "outline"}
                    size="sm"
                    className={isActive ? "bg-indigo-600 hover:bg-indigo-700" : ""}
                  >
                    <Link href={href}>
                      <Icon className="h-3.5 w-3.5 mr-1.5" />
                      {tab.label}
                      <Badge
                        variant="secondary"
                        className="ml-1.5 h-5 px-1.5 text-[10px] font-normal"
                      >
                        {tab.count}
                      </Badge>
                    </Link>
                  </Button>
                );
              })}
            </div>
          </CardHeader>
          <CardContent>
            <VouchersTable
              vouchers={enrichedVouchers}
              services={services}
              accessAreas={accessAreas}
              currentQuery={queryTrim}
              currentStatus={status}
              currentSort={sort}
              currentOrder={order}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
