"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Ticket, QrCode, Monitor, Menu, Shield, Building } from "lucide-react";
import { useMobileMenu } from "@/components/layout/mobile-menu-context";
import { isNavItemActive } from "@/components/layout/nav-config";
import { cn } from "@/lib/utils";

const TENANT_TABS = [
  { href: "/", label: "Start", icon: LayoutDashboard },
  { href: "/tickets", label: "Tickets", icon: Ticket },
  { href: "/scanner", label: "Scanner", icon: QrCode },
  { href: "/monitor", label: "Monitor", icon: Monitor },
] as const;

const ADMIN_TABS = [
  { href: "/admin", label: "Admin", icon: Shield },
  { href: "/admin/accounts", label: "Mandanten", icon: Building },
] as const;

/**
 * Untere Tab-Leiste fuer Handys (unter md). Die haeufigsten Ziele direkt,
 * alles andere ueber "Mehr" im Seitenmenue. Safe-Area unten wird
 * beruecksichtigt, damit auf dem iPhone nichts hinter der Home-Leiste liegt.
 */
export function MobileTabBar({ role }: { role?: string }) {
  const pathname = usePathname();
  const menu = useMobileMenu();
  const tabs = role === "SUPER_ADMIN" ? ADMIN_TABS : TENANT_TABS;
  const cols = tabs.length + 1;

  return (
    <nav
      aria-label="Hauptnavigation"
      className="md:hidden fixed inset-x-0 bottom-0 z-30 glass border-t pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="grid h-14" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {tabs.map((tab) => {
          const active =
            tab.href === "/admin" ? pathname === "/admin" : isNavItemActive(pathname, tab.href);
          return (
            <li key={tab.href} className="min-w-0">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium select-none transition-colors",
                  active ? "text-primary" : "text-muted-foreground active:text-foreground",
                )}
              >
                {active && (
                  <span aria-hidden className="absolute top-0 h-0.5 w-8 rounded-b-full bg-primary" />
                )}
                <tab.icon className="h-5 w-5" strokeWidth={active ? 2.5 : 2} />
                <span className="truncate max-w-full px-1">{tab.label}</span>
              </Link>
            </li>
          );
        })}
        <li className="min-w-0">
          <button
            type="button"
            onClick={menu?.toggle}
            aria-expanded={menu?.open}
            className={cn(
              "flex h-full w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium select-none transition-colors",
              menu?.open ? "text-primary" : "text-muted-foreground active:text-foreground",
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
