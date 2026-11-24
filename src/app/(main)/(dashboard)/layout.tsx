import { safeAuth } from "@/lib/auth";
import { SessionShell } from "@/components/layout/session-shell";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await safeAuth();
  return (
    <SessionShell session={session} fallbackName="User" fallbackRole="USER">
      {children}
    </SessionShell>
  );
}
