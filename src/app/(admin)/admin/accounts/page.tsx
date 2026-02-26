import { safeAuth } from "@/lib/auth";
import { superAdminClient } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { AccountsClient } from "@/components/admin/accounts-client";

export default async function AccountsPage() {
  const session = await safeAuth();
  if (!session?.user || session.user.role !== "SUPER_ADMIN") redirect("/");

  const accounts = await superAdminClient.account.findMany({
    include: {
      _count: { select: { admins: true, devices: true, tickets: true, scans: true } },
    },
    orderBy: { name: "asc" },
  });

  return (
    <>
      <Header title="Mandanten-Verwaltung" />
      <div className="p-6">
        <AccountsClient accounts={JSON.parse(JSON.stringify(accounts))} />
      </div>
    </>
  );
}
