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

  const [lockers, subscriptions] = await Promise.all([
    db.locker.findMany({
      where: accountFilter,
      include: {
        subscription: { select: { id: true, name: true } },
      },
      orderBy: [{ location: "asc" }, { number: "asc" }],
    }),
    db.subscription.findMany({
      where: accountFilter,
      select: { id: true, name: true },
      orderBy: { name: "asc" },
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
              Verwalte Schließfächer mit Name, Standort und Nummer und verknüpfe sie optional mit{" "}
              <Link href="/subscriptions" className="text-indigo-600 dark:text-indigo-400 hover:underline">
                Abos
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
                subscriptionId: l.subscriptionId,
                subscription: l.subscription,
              }))}
              subscriptions={subscriptions}
              readonly={isSuperAdmin}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
