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

  const [vereine, areas, allTickets] = await Promise.all([
    db.verein.findMany({
      where: accountFilter,
      include: {
        areas: {
          include: { accessArea: { select: { id: true, name: true } } },
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
    db.accessArea.findMany({
      where: accountFilter,
      select: { id: true, name: true },
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
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
  ]);

  return (
    <>
      <Header title="Vereine" accountName={session.user.accountName} />
      <div className="p-4 sm:p-6">
        <Card className="border-slate-200 dark:border-slate-800">
          <CardHeader className="pb-4">
            <CardTitle className="text-base sm:text-xl">Alle Vereine ({vereine.length})</CardTitle>
            <CardDescription>
              Vereine bündeln <Link href="/tickets" className="text-indigo-600 dark:text-indigo-400 hover:underline">Mitglieds-Tickets</Link> und gewähren ihnen automatisch Zutritt zu den ausgewählten <Link href="/areas" className="text-indigo-600 dark:text-indigo-400 hover:underline">Resourcen</Link> (z. B. Bahnmiete).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <VereineTable
              vereine={vereine.map((v) => ({
                id: v.id,
                name: v.name,
                description: v.description,
                areas: v.areas.map((va) => va.accessArea),
                members: v.members,
                _count: v._count,
              }))}
              areas={areas}
              allTickets={allTickets}
              readonly={isSuperAdmin}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
