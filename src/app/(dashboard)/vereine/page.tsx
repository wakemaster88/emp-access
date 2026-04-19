import { safeAuth } from "@/lib/auth";
import { tenantClient, superAdminClient } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { VereineTable } from "@/components/vereine/vereine-table";

export default async function VereinePage() {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");

  const isSuperAdmin = session.user.role === "SUPER_ADMIN";
  const db = isSuperAdmin ? superAdminClient : tenantClient(session.user.accountId!);
  const accountFilter = isSuperAdmin ? {} : { accountId: session.user.accountId! };

  const [vereine, allTickets] = await Promise.all([
    db.verein.findMany({
      where: accountFilter,
      include: {
        accessTickets: {
          include: {
            ticket: {
              select: {
                id: true,
                name: true,
                ticketTypeName: true,
                accessAreaId: true,
                accessArea: { select: { id: true, name: true } },
                ticketAreas: { select: { accessArea: { select: { id: true, name: true } } } },
              },
            },
          },
        },
        members: {
          select: {
            id: true,
            name: true,
            firstName: true,
            lastName: true,
            status: true,
            ticketTypeName: true,
            rfidCode: true,
            barcode: true,
            startDate: true,
            endDate: true,
          },
          orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        },
        _count: { select: { members: true } },
      },
      orderBy: { name: "asc" },
    }),
    db.ticket.findMany({
      where: { ...accountFilter, status: { in: ["VALID", "REDEEMED", "PAUSED"] } },
      select: {
        id: true,
        name: true,
        firstName: true,
        lastName: true,
        ticketTypeName: true,
        vereinId: true,
        accessArea: { select: { id: true, name: true } },
        ticketAreas: { select: { accessArea: { select: { id: true, name: true } } } },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
  ]);

  // Tickets, die als Zutritts-Ticket auswählbar sind (alle aktiven Tickets).
  const allTicketsForUI = allTickets.map((t) => ({
    id: t.id,
    name: t.name,
    firstName: t.firstName,
    lastName: t.lastName,
    ticketTypeName: t.ticketTypeName,
    vereinId: t.vereinId,
    areaNames: [
      ...(t.accessArea ? [t.accessArea.name] : []),
      ...t.ticketAreas.map((ta) => ta.accessArea.name),
    ],
  }));

  return (
    <>
      <Header title="Vereine" accountName={session.user.accountName} />
      <div className="p-4 sm:p-6">
        <Card className="border-slate-200 dark:border-slate-800">
          <CardHeader className="pb-4">
            <CardTitle className="text-base sm:text-xl">Alle Vereine ({vereine.length})</CardTitle>
            <CardDescription>
              Vereine bündeln <Link href="/tickets" className="text-indigo-600 dark:text-indigo-400 hover:underline">Mitglieds-Tickets</Link> und erben beim Scan automatisch den Zutritt der hinterlegten <Link href="/tickets" className="text-indigo-600 dark:text-indigo-400 hover:underline">Zutritts-Tickets</Link> (z. B. „Bahnmiete“).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <VereineTable
              vereine={vereine.map((v) => ({
                id: v.id,
                name: v.name,
                description: v.description,
                accessTickets: v.accessTickets.map((at) => ({
                  id: at.ticket.id,
                  name: at.ticket.name,
                  ticketTypeName: at.ticket.ticketTypeName,
                  areaNames: [
                    ...(at.ticket.accessArea ? [at.ticket.accessArea.name] : []),
                    ...at.ticket.ticketAreas.map((ta) => ta.accessArea.name),
                  ],
                  daysOfWeek: at.daysOfWeek,
                  slotStart: at.slotStart,
                  slotEnd: at.slotEnd,
                })),
                members: v.members,
                _count: v._count,
              }))}
              allTickets={allTicketsForUI}
              readonly={isSuperAdmin}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
