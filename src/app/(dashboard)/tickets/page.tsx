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
import { Eye, EyeOff } from "lucide-react";

interface Props {
  searchParams: Promise<{ showAll?: string }>;
}

export default async function TicketsPage({ searchParams }: Props) {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");

  const { showAll } = await searchParams;
  const showInactive = showAll === "1";

  const isSuperAdmin = session.user.role === "SUPER_ADMIN";
  const db = isSuperAdmin ? superAdminClient : tenantClient(session.user.accountId!);

  const baseWhere = isSuperAdmin ? {} : { accountId: session.user.accountId! };
  const statusFilter = showInactive ? {} : { status: "VALID" as const };

  const [tickets, areas, inactiveCount] = await Promise.all([
    db.ticket.findMany({
      where: { ...baseWhere, ...statusFilter },
      include: { accessArea: true, _count: { select: { scans: true } } },
      orderBy: { updatedAt: "desc" },
      take: 500,
    }),
    db.accessArea.findMany({
      where: baseWhere,
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    showInactive
      ? Promise.resolve(0)
      : db.ticket.count({ where: { ...baseWhere, status: { not: "VALID" } } }),
  ]);

  const toggleHref = showInactive ? "/tickets" : "/tickets?showAll=1";

  return (
    <>
      <Header title="Tickets" accountName={session.user.accountName} />
      <div className="p-6">
        <Card className="border-slate-200 dark:border-slate-800">
          <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <CardTitle>
                {showInactive ? "Alle Tickets" : "Aktive Tickets"} ({tickets.length})
              </CardTitle>
              {!showInactive && inactiveCount > 0 && (
                <Badge variant="secondary" className="text-xs font-normal">
                  + {inactiveCount} inaktive
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button asChild variant="outline" size="sm" className={showInactive ? "border-indigo-300 text-indigo-600 dark:border-indigo-700 dark:text-indigo-400" : ""}>
                <Link href={toggleHref}>
                  {showInactive
                    ? <><EyeOff className="h-4 w-4 mr-1.5" />Nur aktive</>
                    : <><Eye className="h-4 w-4 mr-1.5" />Auch inaktive</>}
                </Link>
              </Button>
              {!isSuperAdmin && <AddTicketDialog areas={areas} />}
            </div>
          </CardHeader>
          <CardContent>
            <TicketsTable
              tickets={tickets as never}
              areas={areas}
              readonly={isSuperAdmin}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
