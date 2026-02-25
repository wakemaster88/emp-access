"use client";

import { signOut, useSession } from "next-auth/react";
import { Sidebar } from "@/components/layout/sidebar";
import { SessionProvider } from "next-auth/react";

function DashboardShell({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();

  if (!session?.user) return null;

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 dark:bg-slate-950">
      <Sidebar
        userName={session.user.name || "User"}
        role={session.user.role || "USER"}
        onSignOut={() => signOut({ callbackUrl: "/login" })}
      />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <DashboardShell>{children}</DashboardShell>
    </SessionProvider>
  );
}
