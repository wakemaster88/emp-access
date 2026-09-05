"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Ticket, QrCode, Monitor, Menu } from "lucide-react";
import { useMobileMenu } from "@/components/layout/mobile-menu-context";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/", label: "Start", icon: LayoutDashboard },
  { href: "/tickets", label: "Tickets", icon: Ticket },
  { href: "/scanner", label: "Scanner", icon: QrCode },
  { href: "/monitor", label: "Monitor", icon: Monitor },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Untere Tab-Leiste fuer Handys (unter md). Die vier haeufigsten Ziele
 * direkt, alles andere ueber "Mehr" im Seitenmenue. Safe-Area unten wird
 * beruecksichtigt, damit auf dem iPhone nichts hinter der Home-Leiste liegt.
 */
export function MobileTabBar() {
  const pathname = usePathname();
  const menu = useMobileMenu();

  return (
    <nav
      aria-label="Hauptnavigation"
      className="md:hidden fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-950/90 backdrop-blur pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="grid grid-cols-5 h-14">
        {TABS.map((tab) => {
          const active = isActive(pathname, tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium select-none",
                  active ? "text-indigo-600 dark:text-indigo-400" : "text-slate-500 dark:text-slate-400",
                )}
              >
                <tab.icon className={cn("h-5 w-5", active && "stroke-[2.5]")} />
                {tab.label}
              </Link>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            onClick={menu?.toggle}
            className={cn(
              "flex h-full w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium select-none",
              menu?.open ? "text-indigo-600 dark:text-indigo-400" : "text-slate-500 dark:text-slate-400",
            )}
          >
            <Menu className="h-5 w-5" />
            Mehr
          </button>
        </li>
      </ul>
    </nav>
  );
}
