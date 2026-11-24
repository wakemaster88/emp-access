"use client";

import { useSyncExternalStore } from "react";
import type { Session } from "next-auth";
import { SessionProvider, signOut, useSession } from "next-auth/react";
import { DashboardShellInner } from "@/components/layout/dashboard-shell-inner";
import { ShellLoading } from "@/components/layout/shell-loading";

interface SessionShellProps {
  /** Sitzung vom Server (Layout); damit wartet nichts mehr auf /api/auth/session. */
  session: Session | null;
  /** Ersatzwerte, falls die Sitzung keinen Namen bzw. keine Rolle trägt. */
  fallbackName: string;
  fallbackRole: string;
  children: React.ReactNode;
}

const subscribeNoop = () => () => {};

function Shell({ fallbackName, fallbackRole, children }: Omit<SessionShellProps, "session">) {
  const { data: session, status } = useSession();
  // Seiteninhalt nur im Browser rendern, wie vor der Server-Sitzung: viele
  // Seiten lesen beim Rendern window oder formatieren Daten in der Zeitzone
  // des Browsers – auf dem Server gerendert passte das beim Hydrieren nicht.
  // Auf dem Server und beim Hydrieren false, danach true.
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);

  if (!mounted || status === "loading") return <ShellLoading />;

  if (status === "unauthenticated" || !session?.user) {
    if (typeof window !== "undefined") window.location.href = "/login";
    return null;
  }

  return (
    <DashboardShellInner
      userName={session.user.name || fallbackName}
      role={session.user.role || fallbackRole}
      onSignOut={() => signOut({ callbackUrl: "/login" })}
    >
      {children}
    </DashboardShellInner>
  );
}

/**
 * Rahmen der Verwaltung (Seitenleiste, Handy-Menü, Tab-Leiste) mit der
 * Sitzung, die das Layout auf dem Server schon gelesen hat. Der Ladering
 * steht nur, bis das Skript im Browser läuft. Alle 4 Minuten
 * holt der Browser die Sitzung neu (refetchInterval) – so erneuert sich das
 * Cookie mit dem Prüfzeitpunkt, bevor die 5-Minuten-Prüfung in auth.ts fällig ist.
 */
export function SessionShell({ session, ...rest }: SessionShellProps) {
  return (
    <SessionProvider session={session} refetchInterval={240}>
      <Shell {...rest} />
    </SessionProvider>
  );
}
