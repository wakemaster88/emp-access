import { safeAuth } from "@/lib/auth";
import { tenantClient, superAdminClient } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { LockersTable } from "@/components/lockers/lockers-table";

export default async function LockersPage() {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");

  const isSuperAdmin = session.user.role === "SUPER_ADMIN";
  const db = isSuperAdmin ? superAdminClient : tenantClient(session.user.accountId!);
  const accountFilter = isSuperAdmin ? {} : { accountId: session.user.accountId! };

  // Wir laden nur Abo-Tickets (subscriptionId != null), denn Schließfächer
  // werden konkreten Abo-Inhabern zugeordnet, nicht Tagesgästen.
  const [lockers, aboTickets] = await Promise.all([
    db.locker.findMany({
      where: accountFilter,
      include: {
        ticket: {
          select: {
            id: true,
            name: true,
            firstName: true,
            lastName: true,
            ticketTypeName: true,
            status: true,
            endDate: true,
            subscription: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ location: "asc" }, { number: "asc" }],
    }),
    db.ticket.findMany({
      where: {
        ...accountFilter,
        subscriptionId: { not: null },
      },
      select: {
        id: true,
        name: true,
        firstName: true,
        lastName: true,
        ticketTypeName: true,
        status: true,
        endDate: true,
        subscription: { select: { id: true, name: true } },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { name: "asc" }],
    }),
  ]);

  return (
    <>
      <Header title="Schließfächer" accountName={session.user.accountName} />
      <div className="p-4 sm:p-6">
        <Card className="border-slate-200 dark:border-slate-800">
          <CardHeader className="pb-4">
            <CardTitle className="text-base sm:text-xl">Alle Schließfächer ({lockers.length})</CardTitle>
            <CardDescription>
              Verwalte Schließfächer mit Name, Standort und Nummer und verknüpfe sie optional mit einem{" "}
              <Link href="/tickets" className="text-indigo-600 dark:text-indigo-400 hover:underline">
                Abo-Ticket
              </Link>
              .
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LockersTable
              lockers={lockers.map((l) => ({
                id: l.id,
                name: l.name,
                number: l.number,
                location: l.location,
                notes: l.notes,
                ticketId: l.ticketId,
                ticket: l.ticket
                  ? {
                      id: l.ticket.id,
                      name: l.ticket.name,
                      firstName: l.ticket.firstName,
                      lastName: l.ticket.lastName,
                      ticketTypeName: l.ticket.ticketTypeName,
                      status: l.ticket.status,
                      endDate: l.ticket.endDate ? l.ticket.endDate.toISOString() : null,
                      subscription: l.ticket.subscription,
                    }
                  : null,
              }))}
              aboTickets={aboTickets.map((t) => ({
                id: t.id,
                name: t.name,
                firstName: t.firstName,
                lastName: t.lastName,
                ticketTypeName: t.ticketTypeName,
                status: t.status,
                endDate: t.endDate ? t.endDate.toISOString() : null,
                subscription: t.subscription,
              }))}
              readonly={isSuperAdmin}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
