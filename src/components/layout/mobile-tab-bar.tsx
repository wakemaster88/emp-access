"use client";

import { useEffect, useState } from "react";
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

/** Ab so viel Scrollweg nach unten wird die Leiste kompakt. */
const COMPACT_AFTER_PX = 64;
/** Kleine Zitterbewegungen beim Scrollen ignorieren. */
const SCROLL_SLOP_PX = 6;

/** Federnde Bewegung der Linse und der Leiste (leichtes Überschwingen). */
const SPRING = "duration-500 ease-[cubic-bezier(0.32,1.4,0.56,1)] motion-reduce:transition-none";

const ITEM =
  "press relative z-10 flex h-full w-full flex-col items-center justify-center rounded-full select-none outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

/**
 * Scrollt der Inhalt nach unten, wird die Leiste kompakt (nur Symbole), beim
 * Zurückscrollen oder oben auf der Seite wieder voll – wie die Tab-Leiste
 * in iOS 26/27. Gescrollt wird in der Hülle (`main[data-shell-main]`).
 */
function useCompactOnScroll(pathname: string) {
  // Gilt nur für die Seite, auf der gescrollt wurde: eine neue Seite zeigt die Leiste wieder voll.
  const [state, setState] = useState({ path: pathname, compact: false });

  useEffect(() => {
    const setCompact = (compact: boolean) => {
      const path = window.location.pathname;
      setState((prev) => (prev.compact === compact && prev.path === path ? prev : { path, compact }));
    };
    const el = document.querySelector<HTMLElement>("main[data-shell-main]");
    if (!el) return;
    let last = el.scrollTop;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const top = el.scrollTop;
        const delta = top - last;
        if (top < COMPACT_AFTER_PX) setCompact(false);
        else if (delta > SCROLL_SLOP_PX) setCompact(true);
        else if (delta < -SCROLL_SLOP_PX) setCompact(false);
        if (Math.abs(delta) > SCROLL_SLOP_PX || top < COMPACT_AFTER_PX) last = top;
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return state.path === pathname && state.compact;
}

/**
 * Untere Tab-Leiste für Handys (unter md) im Stil von iOS 26/27 (Liquid
 * Glass): eine schwebende, durchscheinende Kapsel mit den häufigsten Zielen
 * und daneben ein runder Glasknopf „Mehr“ für das Seitenmenü. Der aktive
 * Eintrag sitzt auf einer Linse, die federnd zum angetippten Tab gleitet.
 * Beim Scrollen nach unten schrumpft die Leiste auf die Symbole.
 */
export function MobileTabBar({ role }: { role?: string }) {
  const pathname = usePathname();
  const menu = useMobileMenu();
  const compact = useCompactOnScroll(pathname);
  const tabs = role === "SUPER_ADMIN" ? ADMIN_TABS : TENANT_TABS;

  const activeIndex = tabs.findIndex((tab) =>
    tab.href === "/admin" ? pathname === "/admin" : isNavItemActive(pathname, tab.href),
  );
  const height = compact ? "h-12" : "h-[60px]";

  return (
    <div
      data-compact={compact || undefined}
      className="md:hidden pointer-events-none fixed inset-x-0 z-30 flex items-end justify-center gap-2.5 px-3.5 bottom-[max(0.75rem,calc(env(safe-area-inset-bottom)-0.25rem))] pl-[max(0.875rem,env(safe-area-inset-left))] pr-[max(0.875rem,env(safe-area-inset-right))]"
    >
      <nav
        aria-label="Hauptnavigation"
        className={cn(
          "glass-dock pointer-events-auto relative min-w-0 max-w-md flex-1 p-1 transition-[height]",
          SPRING,
          height,
        )}
      >
        {activeIndex >= 0 && (
          <span
            aria-hidden
            className={cn("glass-lens absolute inset-y-1 left-1 transition-transform", SPRING)}
            style={{
              width: `calc((100% - 0.5rem) / ${tabs.length})`,
              transform: `translateX(${activeIndex * 100}%)`,
            }}
          />
        )}
        <ul className="relative grid h-full" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
          {tabs.map((tab, i) => {
            const active = i === activeIndex;
            return (
              <li key={tab.href} className="min-w-0">
                <Link
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  aria-label={tab.label}
                  className={cn(
                    ITEM,
                    active ? "text-primary" : "text-foreground/75 active:text-foreground",
                  )}
                >
                  <tab.icon className="h-[22px] w-[22px] shrink-0" strokeWidth={active ? 2.3 : 1.9} />
                  <span
                    aria-hidden
                    className={cn(
                      "max-w-full truncate px-1 text-[10.5px] font-semibold leading-tight transition-[max-height,opacity,margin]",
                      SPRING,
                      compact ? "mt-0 max-h-0 opacity-0" : "mt-0.5 max-h-4 opacity-100",
                    )}
                  >
                    {tab.label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <button
        type="button"
        onClick={menu?.toggle}
        aria-expanded={menu?.open}
        aria-label="Mehr"
        className={cn(
          "glass-dock pointer-events-auto flex shrink-0 items-center justify-center outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 transition-[height,width,transform,color] active:scale-95",
          SPRING,
          compact ? "h-12 w-12" : "h-[60px] w-[60px]",
          menu?.open ? "text-primary" : "text-foreground/75",
        )}
      >
        <Menu className="h-[22px] w-[22px]" strokeWidth={1.9} />
      </button>
    </div>
  );
}
