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

const ITEM =
  "press relative flex h-full w-full flex-col items-center justify-center gap-0.5 rounded-full text-[10.5px] font-medium select-none outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

/**
 * Untere Tab-Leiste fuer Handys (unter md) im Stil von iOS 26: eine
 * schwebende Glas-Kapsel ueber dem Inhalt, der aktive Eintrag als helle
 * Glas-Pille. Die haeufigsten Ziele direkt, alles andere ueber "Mehr" im
 * Seitenmenue. Die Kapsel haelt Abstand zur Home-Leiste (Safe-Area).
 */
export function MobileTabBar({ role }: { role?: string }) {
  const pathname = usePathname();
  const menu = useMobileMenu();
  const tabs = role === "SUPER_ADMIN" ? ADMIN_TABS : TENANT_TABS;
  const cols = tabs.length + 1;

  return (
    <nav
      aria-label="Hauptnavigation"
      className="md:hidden fixed inset-x-3 bottom-[calc(0.5rem+env(safe-area-inset-bottom))] z-30 glass-dock p-1"
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
                  ITEM,
                  active ? "glass-pill-active text-primary" : "text-muted-foreground active:text-foreground",
                )}
              >
                <tab.icon className="h-5 w-5" strokeWidth={active ? 2.4 : 2} />
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
              ITEM,
              menu?.open ? "glass-pill-active text-primary" : "text-muted-foreground active:text-foreground",
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
