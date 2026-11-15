"use client";

import { Sidebar } from "@/components/layout/sidebar";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { MobileMenuProvider, useMobileMenu } from "@/components/layout/mobile-menu-context";
import { MobileTabBar } from "@/components/layout/mobile-tab-bar";
import { ThemeColorSync } from "@/components/layout/theme-color-sync";
import { InstallPrompt } from "@/components/pwa/install-prompt";

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
      <div className="hidden md:flex h-[100dvh] max-h-[100dvh] shrink-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]">
        <Sidebar userName={userName} role={role} onSignOut={onSignOut} />
      </div>

      {/* Handy: Seitenleiste als Sheet von links. */}
      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent
          side="left"
          className="w-[288px] max-w-[85vw] p-0 gap-0 rounded-r-card border-r border-sidebar-border bg-sidebar text-sidebar-foreground [&>button]:text-sidebar-muted"
          showCloseButton={true}
          // Nicht die Suche fokussieren: sonst klappt auf dem Handy bei jedem Öffnen die Tastatur auf.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement | null)?.focus();
          }}
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <div className="h-full pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
            <Sidebar userName={userName} role={role} onSignOut={onSignOut} onNavigate={() => setMobileMenuOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>

      {/* Inhalt: liegt direkt auf dem ruhigen Grund der Hülle und scrollt unter
          der gläsernen Tab-Leiste durch (die Leiste liest `data-shell-main`). */}
      <main
        data-shell-main
        className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain scrollbar-thin pb-[calc(5.75rem+env(safe-area-inset-bottom))] md:pb-0"
      >
        {children}
      </main>

      <MobileTabBar role={role} />
      {/* Handy im Browser: Hinweis „als App installieren“, über der Tab-Leiste. */}
      <InstallPrompt variant="banner" aboveTabBar />
      <ThemeColorSync />
    </>
  );
}

/**
 * Rahmen aller angemeldeten Seiten (Mandant und Superadmin): ruhiger Grund
 * (`page-ambient`), feste Seitenleiste, scrollender Inhalt, schwebende
 * Tab-Leiste auf dem Handy.
 */
export function DashboardShellInner(props: DashboardShellInnerProps) {
  return (
    <MobileMenuProvider>
      <div className="page-ambient flex min-h-[100dvh] max-h-[100dvh] overflow-hidden">
        <Inner {...props} />
      </div>
    </MobileMenuProvider>
  );
}
