import { safeAuth } from "@/lib/auth";
import { SessionShell } from "@/components/layout/session-shell";

/**
 * Superadmin-Bereich: derselbe Rahmen wie das Mandanten-Dashboard
 * (Seitenleiste, Handy-Menü, Tab-Leiste), nur mit Admin-Navigation.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await safeAuth();
  return (
    <SessionShell session={session} fallbackName="Admin" fallbackRole="SUPER_ADMIN">
      {children}
    </SessionShell>
  );
}
