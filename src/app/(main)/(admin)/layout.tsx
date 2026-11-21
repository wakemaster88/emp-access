"use client";

import { signOut, useSession } from "next-auth/react";
import { SessionProvider } from "next-auth/react";
import { DashboardShellInner } from "@/components/layout/dashboard-shell-inner";
import { ShellLoading } from "@/components/layout/shell-loading";

/**
 * Superadmin-Bereich: derselbe Rahmen wie das Mandanten-Dashboard
 * (Seitenleiste, Handy-Menü, Tab-Leiste), nur mit Admin-Navigation.
 */
function AdminShell({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();

  if (status === "loading") return <ShellLoading />;

  if (status === "unauthenticated" || !session?.user) {
    if (typeof window !== "undefined") window.location.href = "/login";
    return null;
  }

  return (
    <DashboardShellInner
      userName={session.user.name || "Admin"}
      role={session.user.role || "SUPER_ADMIN"}
      onSignOut={() => signOut({ callbackUrl: "/login" })}
    >
      {children}
    </DashboardShellInner>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <AdminShell>{children}</AdminShell>
    </SessionProvider>
  );
}
