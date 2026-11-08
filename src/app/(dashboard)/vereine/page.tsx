import { safeAuth } from "@/lib/auth";
import { tenantClient, superAdminClient } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { Card, CardAction, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CreateVereinButton, VereineTable } from "@/components/vereine/vereine-table";
import { VereineTabs } from "@/components/vereine/vereine-tabs";

export default async function VereinePage() {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");

  const isSuperAdmin = session.user.role === "SUPER_ADMIN";
  const db = isSuperAdmin ? superAdminClient : tenantClient(session.user.accountId!);
  const accountFilter = isSuperAdmin ? {} : { accountId: session.user.accountId! };

  const [vereine, allTickets, pendingRequests] = await Promise.all([
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
                validityType: true,
                slotStart: true,
                slotEnd: true,
                startDate: true,
                endDate: true,
                validityDurationMinutes: true,
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
        validityType: true,
        slotStart: true,
        slotEnd: true,
        startDate: true,
        endDate: true,
        validityDurationMinutes: true,
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
    isSuperAdmin
      ? Promise.resolve(0)
      : db.vereinSlotBooking.count({ where: { ...accountFilter, status: "REQUESTED", endDate: { gt: new Date() } } }),
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
    validityType: t.validityType,
    slotStart: t.slotStart,
    slotEnd: t.slotEnd,
    startDate: t.startDate ? t.startDate.toISOString() : null,
    endDate: t.endDate ? t.endDate.toISOString() : null,
    validityDurationMinutes: t.validityDurationMinutes,
  }));

  return (
    <>
      <Header title="Vereine" accountName={session.user.accountName} />
      <div className="page-content space-y-4 sm:space-y-5">
        <VereineTabs value="vereine" openCount={pendingRequests} />
        {/* Tabelle läuft bis an den Kartenrand: Karte unten und Inhalt seitlich ohne Innenabstand. */}
        <Card flush>
          <CardHeader>
            <CardTitle>Alle Vereine ({vereine.length})</CardTitle>
            <CardDescription>
              Vereine bündeln <Link href="/tickets" className="text-primary hover:underline">Mitglieds-Tickets</Link> und erben beim Scan automatisch den Zutritt der hinterlegten <Link href="/tickets" className="text-primary hover:underline">Zutritts-Tickets</Link> (z. B. „Bahnmiete“).
            </CardDescription>
            {/* Primärhandlung oben rechts im Kartenkopf (docs/design-regeln.md, Abschnitt 13). */}
            {!isSuperAdmin && (
              <CardAction>
                <CreateVereinButton allTickets={allTicketsForUI} />
              </CardAction>
            )}
          </CardHeader>
          <CardContent className="px-0 sm:px-0">
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
                  validityType: at.ticket.validityType,
                  slotStart: at.ticket.slotStart,
                  slotEnd: at.ticket.slotEnd,
                  startDate: at.ticket.startDate ? at.ticket.startDate.toISOString() : null,
                  endDate: at.ticket.endDate ? at.ticket.endDate.toISOString() : null,
                  validityDurationMinutes: at.ticket.validityDurationMinutes,
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
