import { safeAuth } from "@/lib/auth";
import { tenantClient, superAdminClient } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { LockersTable } from "@/components/lockers/lockers-table";

/// Aktuelles Vermietungsjahr in Berlin-Zeit (Default-Zone der App).
function currentYearBerlin(): number {
  // toLocaleString gibt den Jahres-Bestandteil als Zahl zurück; Fallback = JS-Default.
  const fmt = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", year: "numeric" });
  const y = Number(fmt.format(new Date()));
  return Number.isFinite(y) ? y : new Date().getFullYear();
}

export default async function LockersPage() {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");

  const isSuperAdmin = session.user.role === "SUPER_ADMIN";
  const db = isSuperAdmin ? superAdminClient : tenantClient(session.user.accountId!);
  const accountFilter = isSuperAdmin ? {} : { accountId: session.user.accountId! };

  const currentYear = currentYearBerlin();

  // Wir laden nur Abo-Tickets (subscriptionId != null), denn Schließfächer
  // werden konkreten Abo-Inhabern zugeordnet, nicht Tagesgästen.
  const [lockers, aboTickets] = await Promise.all([
    db.locker.findMany({
      where: accountFilter,
      include: {
        rentals: {
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
          orderBy: { year: "desc" },
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

  const lockerRows = lockers.map((l) => ({
    id: l.id,
    name: l.name,
    number: l.number,
    location: l.location,
    notes: l.notes,
    lockType: l.lockType,
    keyCount: l.keyCount,
    lockNumber: l.lockNumber,
    rentals: l.rentals.map((r) => ({
      id: r.id,
      year: r.year,
      notes: r.notes,
      ticketId: r.ticketId,
      renterName: r.renterName,
      keysIssued: r.keysIssued,
      keysReturned: r.keysReturned,
      issuedAt: r.issuedAt ? r.issuedAt.toISOString() : null,
      returnedAt: r.returnedAt ? r.returnedAt.toISOString() : null,
      ticket: r.ticket
        ? {
            id: r.ticket.id,
            name: r.ticket.name,
            firstName: r.ticket.firstName,
            lastName: r.ticket.lastName,
            ticketTypeName: r.ticket.ticketTypeName,
            status: r.ticket.status,
            endDate: r.ticket.endDate ? r.ticket.endDate.toISOString() : null,
            subscription: r.ticket.subscription,
          }
        : null,
    })),
  }));

  return (
    <>
      <Header title="Schließfächer" accountName={session.user.accountName} />
      <div className="p-4 sm:p-6">
        <Card className="border-slate-200 dark:border-slate-800">
          <CardHeader className="pb-4">
            <CardTitle className="text-base sm:text-xl">Alle Schließfächer ({lockers.length})</CardTitle>
            <CardDescription>
              Vermietung läuft jahresweise: pro Jahr wird ein{" "}
              <Link href="/tickets" className="text-indigo-600 dark:text-indigo-400 hover:underline">
                Abo-Ticket
              </Link>{" "}
              hinterlegt – die Historie bleibt erhalten.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LockersTable
              lockers={lockerRows}
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
              currentYear={currentYear}
              readonly={isSuperAdmin}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
