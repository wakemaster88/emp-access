import { safeAuth } from "@/lib/auth";
import { tenantClient, superAdminClient } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AddTicketDialog } from "@/components/tickets/add-ticket-dialog";
import { TicketsTable } from "@/components/tickets/tickets-table";
import { TicketCodeSearch } from "@/components/tickets/ticket-code-search";
import { TicketSortFilter } from "@/components/tickets/ticket-sort-filter";
import { AreaFilter } from "@/components/tickets/area-filter";
import { Eye, EyeOff } from "lucide-react";

interface Props {
  searchParams: Promise<{ showAll?: string; area?: string; code?: string; sort?: string; order?: string; source?: string }>;
}

function buildOrderBy(sort: string, order: "asc" | "desc") {
  switch (sort) {
    case "name":
      return { name: order };
    case "resource":
      return { accessArea: { name: order } };
    case "status":
      return { status: order };
    case "date":
    default:
      return { updatedAt: order };
  }
}

export default async function TicketsPage({ searchParams }: Props) {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");

  const { showAll, area, code, sort = "date", order = "desc", source } = await searchParams;
  const showInactive = showAll === "1";
  const areaId = area ? Number(area) : undefined;
  const codeTrim = (code ?? "").trim();
  const orderDir = order === "asc" ? "asc" : "desc";

  const isSuperAdmin = session.user.role === "SUPER_ADMIN";
  const db = isSuperAdmin ? superAdminClient : tenantClient(session.user.accountId!);

  const baseWhere = isSuperAdmin ? {} : { accountId: session.user.accountId! };
  const statusFilter = showInactive ? {} : { status: { in: ["VALID" as const, "REDEEMED" as const] } };
  const areaFilter = areaId ? { accessAreaId: areaId } : {};
  const codeFilter = codeTrim
    ? { OR: [{ barcode: codeTrim }, { qrCode: codeTrim }, { rfidCode: codeTrim }] }
    : {};
  const sourceFilter = (() => {
    if (!source || source === "all") return {};
    if (source === "Eigenes") return { source: null };
    return { source: source as "ANNY" | "WAKESYS" | "EMP_CONTROL" | "BINARYTEC" | "SHELLY" };
  })();

  const [tickets, areas, subscriptions, services, inactiveCount] = await Promise.all([
    db.ticket.findMany({
      where: { ...baseWhere, ...statusFilter, ...areaFilter, ...codeFilter, ...sourceFilter },
      include: { accessArea: true, subscription: true, service: true, _count: { select: { scans: true } } },
      orderBy: buildOrderBy(sort, orderDir),
      take: 500,
    }),
    db.accessArea.findMany({
      where: baseWhere,
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.subscription.findMany({
      where: baseWhere,
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        defaultValidityType: true,
        defaultStartDate: true,
        defaultEndDate: true,
        defaultSlotStart: true,
        defaultSlotEnd: true,
        defaultValidityDurationMinutes: true,
        areas: { select: { id: true } },
      },
    }),
    db.service.findMany({
      where: baseWhere,
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        defaultValidityType: true,
        defaultStartDate: true,
        defaultEndDate: true,
        defaultSlotStart: true,
        defaultSlotEnd: true,
        defaultValidityDurationMinutes: true,
        requiresPhoto: true,
        serviceAreas: { select: { accessAreaId: true } },
      },
    }),
    showInactive
      ? Promise.resolve(0)
      : db.ticket.count({ where: { ...baseWhere, ...areaFilter, status: { notIn: ["VALID", "REDEEMED"] } } }),
  ]);

  const subsWithAreas = subscriptions.map((s) => ({
    ...s,
    areaIds: s.areas.map((a) => a.id),
  }));
  const svcsWithAreas = services.map((s) => ({
    ...s,
    areaIds: s.serviceAreas.map((sa) => sa.accessAreaId),
  }));

  const filterArea = areaId ? areas.find((a) => a.id === areaId) : null;
  const toggleHref = showInactive
    ? `/tickets${area ? `?area=${area}` : ""}`
    : `/tickets?showAll=1${area ? `&area=${area}` : ""}`;

  const sortParam = sort ?? "date";
  const orderParam = order ?? "desc";
  const sourceParam = source ?? "";

  return (
    <>
      <Header title="Tickets" accountName={session.user.accountName} />
      <div className="p-4 sm:p-6">
        <Card className="border-slate-200 dark:border-slate-800">
          <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <CardTitle className="text-base sm:text-lg">
                {showInactive ? "Alle Tickets" : "Aktive Tickets"} ({tickets.length})
              </CardTitle>
              {!showInactive && inactiveCount > 0 && (
                <Badge variant="secondary" className="text-xs font-normal">
                  + {inactiveCount} inaktive
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <TicketSortFilter
                currentSort={sortParam}
                currentOrder={orderParam}
                currentSource={sourceParam}
              />
              {areas.length > 0 && (
                <AreaFilter areas={areas} current={area} />
              )}
              <Button asChild variant="outline" size="sm" className={showInactive ? "border-indigo-300 text-indigo-600 dark:border-indigo-700 dark:text-indigo-400" : ""}>
                <Link href={toggleHref}>
                  {showInactive
                    ? <><EyeOff className="h-4 w-4 mr-1.5" /><span className="hidden xs:inline">Nur aktive</span><span className="xs:hidden">Aktive</span></>
                    : <><Eye className="h-4 w-4 mr-1.5" /><span className="hidden xs:inline">Auch inaktive</span><span className="xs:hidden">Alle</span></>}
                </Link>
              </Button>
              {!isSuperAdmin && <AddTicketDialog areas={areas} subscriptions={subsWithAreas} services={svcsWithAreas} />}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <TicketCodeSearch
              currentCode={codeTrim || undefined}
              currentArea={area}
              currentShowAll={showInactive}
            />
            <TicketsTable
              tickets={tickets as never}
              areas={areas}
              subscriptions={subsWithAreas}
              services={svcsWithAreas}
              readonly={isSuperAdmin}
              searchCode={codeTrim || undefined}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
