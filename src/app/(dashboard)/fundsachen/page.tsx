import { safeAuth } from "@/lib/auth";
import { tenantClient, superAdminClient } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { LostItemsTable } from "@/components/lost-items/lost-items-table";

export default async function FundsachenPage() {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");

  const isSuperAdmin = session.user.role === "SUPER_ADMIN";
  const db = isSuperAdmin ? superAdminClient : tenantClient(session.user.accountId!);
  const accountFilter = isSuperAdmin ? {} : { accountId: session.user.accountId! };

  const items = await db.lostItem.findMany({
    where: accountFilter,
    orderBy: [{ pickedUp: "asc" }, { foundDate: "desc" }],
  });

  return (
    <>
      <Header title="Fundsachen" accountName={session.user.accountName} />
      <div className="p-4 sm:p-6">
        <Card className="border-slate-200 dark:border-slate-800">
          <CardHeader className="pb-4">
            <CardTitle className="text-base sm:text-xl">Fundsachen & Verlustmeldungen ({items.length})</CardTitle>
            <CardDescription>
              Gefundene Gegenstände und Verlustmeldungen können hier im Backend oder am Shop-Monitor erfasst und als erledigt markiert werden.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LostItemsTable
              items={items.map((it) => ({
                id: it.id,
                kind: it.kind,
                description: it.description,
                foundDate: it.foundDate.toISOString(),
                image: it.image,
                contact: it.contact,
                reporterName: it.reporterName,
                callbackPhone: it.callbackPhone,
                pickedUp: it.pickedUp,
                pickedUpAt: it.pickedUpAt ? it.pickedUpAt.toISOString() : null,
              }))}
              readonly={isSuperAdmin}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
