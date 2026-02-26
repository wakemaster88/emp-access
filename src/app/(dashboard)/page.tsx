import { safeAuth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { DashboardClient } from "@/components/dashboard/dashboard-client";

export default async function DashboardPage() {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");

  if (session.user.role === "SUPER_ADMIN") redirect("/admin");

  return (
    <>
      <Header title="Dashboard" accountName={session.user.accountName} />
      <div className="p-6">
        <DashboardClient />
      </div>
    </>
  );
}
