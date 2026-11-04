"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun, Menu, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMobileMenu } from "@/components/layout/mobile-menu-context";
import { cn } from "@/lib/utils";

interface HeaderProps {
  title: string;
  accountName?: string | null;
  /** Rechts neben dem Titel, z. B. ein Live-Punkt oder ein Zähler. */
  badge?: React.ReactNode;
  /** Aktionen rechts im Kopfbalken (Buttons, Filter). */
  children?: React.ReactNode;
  className?: string;
}

function subscribeClock(cb: () => void) {
  const id = setInterval(cb, 10_000);
  return () => clearInterval(id);
}

function readClock(): string {
  return new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
}

/**
 * Uhrzeit rechts im Kopfbalken. Der Server liefert einen Platzhalter, der
 * Client übernimmt nach der Hydration die echte Minute – kein Markup-Konflikt.
 */
function Clock() {
  const now = useSyncExternalStore(subscribeClock, readClock, () => null);
  if (!now) return <span className="hidden sm:inline-block w-[4.5ch]" aria-hidden />;
  return (
    <time className="hidden sm:inline-block text-[13px] font-medium tabular-nums text-muted-foreground w-[5ch] text-right" suppressHydrationWarning>
      {now}
    </time>
  );
}

/**
 * Kopfbalken jeder Dashboard-Seite: Menü-Knopf (Handy), Seitentitel
 * (20 px / 600), Mandant als Kapsel, optionale Aktionen, Uhrzeit und
 * Farbschema. Eine Glasleiste (`glass-bar`), unter der der Inhalt
 * weichgezeichnet durchscrollt.
 */
export function Header({ title, accountName, badge, children, className }: HeaderProps) {
  const { setTheme, theme } = useTheme();
  const mobileMenu = useMobileMenu();

  return (
    <header
      className={cn(
        "sticky top-0 z-30 glass-bar border-b border-glass-border/60 dark:border-white/[0.08]",
        "pt-[env(safe-area-inset-top)]",
        className,
      )}
    >
      <div className="flex h-14 items-center gap-2 px-3 sm:px-5 md:px-6 md:h-16">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {mobileMenu && (
            <Button
              variant="ghost"
              size="icon"
              onClick={mobileMenu.toggle}
              className="md:hidden h-10 w-10 -ml-1 shrink-0 rounded-full text-muted-foreground"
              aria-label="Menü öffnen"
            >
              <Menu className="h-5 w-5" />
            </Button>
          )}
          <h1 className="truncate text-lg font-semibold tracking-tight text-foreground sm:text-xl">{title}</h1>
          {badge}
          {accountName && (
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-glass-border bg-glass-tile px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground shrink-0">
              {accountName}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          {children && <div className="flex items-center gap-1.5">{children}</div>}
          <Clock />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10 sm:h-9 sm:w-9 rounded-full text-muted-foreground hover:text-foreground"
                aria-label="Farbschema"
              >
                <Sun className="h-[18px] w-[18px] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                <Moon className="absolute h-[18px] w-[18px] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-36">
              <DropdownMenuItem onClick={() => setTheme("light")} className={cn(theme === "light" && "bg-primary/12 text-foreground")}>
                <Sun className="h-4 w-4" /> Hell
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("dark")} className={cn(theme === "dark" && "bg-primary/12 text-foreground")}>
                <Moon className="h-4 w-4" /> Dunkel
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("system")} className={cn(theme === "system" && "bg-primary/12 text-foreground")}>
                <Monitor className="h-4 w-4" /> System
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
