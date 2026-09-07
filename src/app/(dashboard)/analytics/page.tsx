import { safeAuth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { AnalyticsClient } from "@/components/analytics/analytics-client";

export default async function AnalyticsPage() {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");

  return (
    <>
      <Header title="Auswertung" accountName={session.user.accountName} />
      <div className="page-content">
        <AnalyticsClient />
      </div>
    </>
  );
}
