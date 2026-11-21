import { safeAuth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Header } from "@/components/layout/header";
import { ScannerClient } from "@/components/scanner/scanner-client";

export default async function ScannerPage() {
  const session = await safeAuth();
  if (!session?.user) redirect("/login");

  return (
    <>
      <Header title="Scanner" accountName={session.user.accountName} />
      <ScannerClient />
    </>
  );
}
