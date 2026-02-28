"use client";

import { Sidebar } from "@/components/layout/sidebar";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { MobileMenuProvider, useMobileMenu } from "@/components/layout/mobile-menu-context";
import { cn } from "@/lib/utils";

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
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden md:flex flex-col h-[100dvh] max-h-[100dvh] bg-slate-900 border-r border-slate-800 transition-all duration-300 w-64 shrink-0",
          "pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]"
        )}
      >
        <Sidebar userName={userName} role={role} onSignOut={onSignOut} />
      </aside>

      {/* Mobile: Sheet with sidebar */}
      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent side="left" className="w-[280px] max-w-[85vw] p-0 gap-0 bg-slate-900 border-slate-800" showCloseButton={true}>
          <div className="pt-[env(safe-area-inset-top)] overflow-y-auto h-full">
            <Sidebar userName={userName} role={role} onSignOut={onSignOut} onNavigate={() => setMobileMenuOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>

      <main className="flex-1 min-w-0 flex flex-col min-h-[100dvh] overflow-hidden bg-slate-50 dark:bg-slate-950">
        {children}
      </main>
    </>
  );
}

export function DashboardShellInner(props: DashboardShellInnerProps) {
  return (
    <MobileMenuProvider>
      <div className="flex min-h-[100dvh] max-h-[100dvh] overflow-hidden bg-slate-50 dark:bg-slate-950">
        <Inner {...props} />
      </div>
    </MobileMenuProvider>
  );
}
