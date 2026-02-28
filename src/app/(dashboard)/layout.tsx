"use client";

import { signOut, useSession } from "next-auth/react";
import { Sidebar } from "@/components/layout/sidebar";
import { SessionProvider } from "next-auth/react";
import { DashboardShellInner } from "@/components/layout/dashboard-shell-inner";

function DashboardShell({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-slate-50 dark:bg-slate-950 safe-area-padding">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

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
