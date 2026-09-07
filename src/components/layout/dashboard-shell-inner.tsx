"use client";

import { Sidebar } from "@/components/layout/sidebar";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { MobileMenuProvider, useMobileMenu } from "@/components/layout/mobile-menu-context";
import { MobileTabBar } from "@/components/layout/mobile-tab-bar";

interface DashboardShellInnerProps {
  userName: string;
  role: string;
  onSignOut: () => void;
  children: React.ReactNode;
}

function Inner({ userName, role, onSignOut, children }: DashboardShellInnerProps) {
  const mobileMenu = useMobileMenu();
  if (!mobileMenu) throw new Error("DashboardShellInner.Inner must be used within MobileMenuProvider");
  const { open: mobileMenuOpen, setOpen: setMobileMenuOpen } = mobileMenu;

  return (
    <>
      {/* Desktop: feste Seitenleiste (Breite bestimmt die Sidebar selbst). */}
      <div className="hidden md:flex h-[100dvh] max-h-[100dvh] shrink-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] bg-sidebar">
        <Sidebar userName={userName} role={role} onSignOut={onSignOut} />
      </div>

      {/* Handy: Seitenleiste als Sheet von links. */}
      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent
          side="left"
          className="w-[280px] max-w-[85vw] p-0 gap-0 bg-sidebar border-sidebar-border text-sidebar-foreground [&>button]:text-sidebar-muted"
          showCloseButton={true}
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <div className="h-full pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
            <Sidebar userName={userName} role={role} onSignOut={onSignOut} onNavigate={() => setMobileMenuOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>

      <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-background scrollbar-thin pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
        {children}
      </main>

      <MobileTabBar role={role} />
    </>
  );
}

/**
 * Rahmen aller angemeldeten Seiten (Mandant und Superadmin): Seitenleiste,
 * scrollender Inhalt, Tab-Leiste auf dem Handy.
 */
export function DashboardShellInner(props: DashboardShellInnerProps) {
  return (
    <MobileMenuProvider>
      <div className="flex min-h-[100dvh] max-h-[100dvh] overflow-hidden bg-background">
        <Inner {...props} />
      </div>
    </MobileMenuProvider>
  );
}
