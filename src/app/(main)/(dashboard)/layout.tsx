"use client";

import { signOut, useSession } from "next-auth/react";
import { SessionProvider } from "next-auth/react";
import { DashboardShellInner } from "@/components/layout/dashboard-shell-inner";
import { ShellLoading } from "@/components/layout/shell-loading";

function DashboardShell({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();

  if (status === "loading") return <ShellLoading />;

  if (status === "unauthenticated" || !session?.user) {
    if (typeof window !== "undefined") window.location.href = "/login";
    return null;
  }

  return (
    <DashboardShellInner
      userName={session.user.name || "User"}
      role={session.user.role || "USER"}
      onSignOut={() => signOut({ callbackUrl: "/login" })}
    >
      {children}
    </DashboardShellInner>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <DashboardShell>{children}</DashboardShell>
    </SessionProvider>
  );
}
