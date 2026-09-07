"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useCallback, useState, useSyncExternalStore } from "react";
import { ChevronDown, LogOut, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  accountItem,
  adminItems,
  isNavItemActive,
  navGroups,
  type NavGroup,
  type NavItem,
} from "@/components/layout/nav-config";

/** Zugeklappte Gruppen, pro Browser gemerkt. Fehlt der Eintrag, ist die Gruppe offen. */
const COLLAPSED_GROUPS_KEY = "emp-access:nav-collapsed-groups";
/** Schmale Leiste (nur Symbole), pro Browser gemerkt. */
const COLLAPSED_SIDEBAR_KEY = "emp-access:nav-collapsed";

function loadCollapsedGroups(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(COLLAPSED_GROUPS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function saveCollapsedGroups(value: Record<string, boolean>) {
  try {
    window.localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(value));
  } catch {
    // Kein Speicher verfügbar (privater Modus o. ä.): Zustand gilt nur für die Sitzung.
  }
}

/*
 * Schmale Leiste als externer Zustand (localStorage). Über useSyncExternalStore
 * rendert der Server „breit“, der Client übernimmt nach der Hydration den
 * gespeicherten Wert – ohne Markup-Abweichung und ohne setState im Effekt.
 */
const collapsedListeners = new Set<() => void>();

function subscribeCollapsed(cb: () => void) {
  collapsedListeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    collapsedListeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_SIDEBAR_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(value: boolean) {
  try {
    window.localStorage.setItem(COLLAPSED_SIDEBAR_KEY, value ? "1" : "0");
  } catch {}
  collapsedListeners.forEach((cb) => cb());
}

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Superadmin",
  ADMIN: "Administrator",
  USER: "Benutzer",
};

interface SidebarProps {
  userName: string;
  role: string;
  onSignOut: () => void;
  /** Gesetzt im Handy-Menü: schließt das Menü nach dem Klick, kein Einklappen. */
  onNavigate?: () => void;
}

export function Sidebar({ userName, role, onSignOut, onNavigate }: SidebarProps) {
  const inSheet = !!onNavigate;
  const storedCollapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false);
  // Im Handy-Menü ist die Leiste immer breit.
  const collapsed = !inSheet && storedCollapsed;
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(loadCollapsedGroups);
  const pathname = usePathname();
  const isSuperAdmin = role === "SUPER_ADMIN";

  const toggleCollapsed = useCallback(() => writeCollapsed(!readCollapsed()), []);

  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      saveCollapsedGroups(next);
      return next;
    });
  }, []);

  const NavLink = ({ href, label, icon: Icon }: NavItem) => {
    const isActive = isNavItemActive(pathname, href);

    const link = (
      <Link
        href={href}
        onClick={onNavigate}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          "group relative flex items-center gap-3 rounded-lg text-sm font-medium transition-colors outline-none",
          "focus-visible:ring-2 focus-visible:ring-sidebar-ring/60",
          collapsed ? "h-10 w-10 justify-center mx-auto" : "px-3 py-2",
          isActive
            ? "bg-sidebar-primary/15 text-white"
            : "text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground",
        )}
      >
        {/* Aktiv-Marke: schmaler Balken am linken Rand. */}
        {isActive && (
          <span
            aria-hidden
            className={cn(
              "absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-sidebar-primary",
              collapsed && "-left-2",
            )}
          />
        )}
        <Icon
          className={cn(
            "h-[18px] w-[18px] shrink-0 transition-colors",
            isActive ? "text-sidebar-primary" : "text-sidebar-muted group-hover:text-sidebar-foreground",
          )}
          strokeWidth={isActive ? 2.25 : 2}
        />
        {!collapsed && <span className="truncate">{label}</span>}
      </Link>
    );

    if (collapsed) {
      return (
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>{link}</TooltipTrigger>
          <TooltipContent side="right" className="font-medium">
            {label}
          </TooltipContent>
        </Tooltip>
      );
    }

    return link;
  };

  const NavGroupBlock = ({ group, isFirst }: { group: NavGroup; isFirst: boolean }) => {
    const isOpen = !collapsedGroups[group.key];
    const hasActive = group.items.some((item) => isNavItemActive(pathname, item.href));

    if (collapsed) {
      return (
        <div className={cn("space-y-1", !isFirst && "pt-2 mt-2 border-t border-sidebar-border")}>
          {group.items.map((item) => (
            <NavLink key={item.href} {...item} />
          ))}
        </div>
      );
    }

    return (
      <div className={cn("space-y-0.5", !isFirst && "pt-3 mt-1")}>
        <button
          type="button"
          onClick={() => toggleGroup(group.key)}
          aria-expanded={isOpen}
          className={cn(
            "flex w-full items-center justify-between rounded-md px-3 pb-1.5 pt-1 outline-none",
            "text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors",
            "text-sidebar-muted/80 hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring/60",
          )}
        >
          <span className="flex items-center gap-1.5">
            {group.label}
            {/* Zugeklappte Gruppe mit aktiver Seite: Punkt zeigt, wo man gerade ist. */}
            {!isOpen && hasActive && <span className="h-1.5 w-1.5 rounded-full bg-sidebar-primary" aria-hidden />}
          </span>
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", !isOpen && "-rotate-90")} />
        </button>
        {isOpen && group.items.map((item) => <NavLink key={item.href} {...item} />)}
      </div>
    );
  };

  const accountActive = isNavItemActive(pathname, accountItem.href);

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 shrink-0 flex-col bg-sidebar text-sidebar-foreground",
        !inSheet && "border-r border-sidebar-border transition-[width] duration-300",
        inSheet ? "w-full" : collapsed ? "w-16" : "w-64",
      )}
    >
      {/* Kopf: Logo + Einklappen */}
      <div className={cn("flex h-14 items-center shrink-0", collapsed ? "justify-center px-2" : "justify-between px-4")}>
        <Link
          href={isSuperAdmin ? "/admin" : "/"}
          className={cn("flex items-center gap-2.5 outline-none rounded-md focus-visible:ring-2 focus-visible:ring-sidebar-ring/60", collapsed && "justify-center")}
          onClick={onNavigate}
        >
          <Image src="/logo-dark.png" alt="EMP Access" width={28} height={28} className="shrink-0" />
          {!collapsed && (
            <span className="flex flex-col leading-none">
              <span className="text-[15px] font-semibold tracking-tight text-white">EMP Access</span>
              <span className="mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-sidebar-muted">
                {isSuperAdmin ? "Superadmin" : "Leitstand"}
              </span>
            </span>
          )}
        </Link>
        {!inSheet && !collapsed && (
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleCollapsed}
            className="h-8 w-8 shrink-0 text-sidebar-muted hover:bg-sidebar-accent hover:text-white"
            aria-label="Seitenleiste einklappen"
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="mx-3 h-px bg-sidebar-border" />

      <nav className={cn("flex-1 min-h-0 overflow-y-auto overscroll-contain py-3 scrollbar-thin", collapsed ? "px-2" : "px-3")}>
        {isSuperAdmin ? (
          <div className="space-y-1">
            {adminItems.map((item) => (
              <NavLink key={item.href} {...item} />
            ))}
          </div>
        ) : (
          navGroups.map((group, idx) => (
            <NavGroupBlock key={group.key} group={group} isFirst={idx === 0} />
          ))
        )}
      </nav>

      {!inSheet && collapsed && (
        <div className="px-2 pb-1">
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleCollapsed}
                className="h-10 w-10 mx-auto flex text-sidebar-muted hover:bg-sidebar-accent hover:text-white"
                aria-label="Seitenleiste erweitern"
              >
                <PanelLeftOpen className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Erweitern</TooltipContent>
          </Tooltip>
        </div>
      )}

      <div className="mx-3 h-px bg-sidebar-border" />

      {/* Benutzerblock: führt zu Konto & Sicherheit, daneben Abmelden. */}
      <div className={cn("p-3", collapsed && "px-2")}>
        <div className={cn("flex items-center gap-1", collapsed && "flex-col gap-2")}>
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Link
                href={accountItem.href}
                onClick={onNavigate}
                aria-current={accountActive ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg min-w-0 transition-colors outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring/60",
                  collapsed ? "p-1" : "flex-1 px-2 py-1.5",
                  accountActive && "bg-sidebar-primary/15",
                )}
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-chart-5 text-sm font-semibold text-white ring-2 ring-sidebar">
                  {userName.charAt(0).toUpperCase()}
                </div>
                {!collapsed && (
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium text-sidebar-foreground">{userName}</p>
                    <p className="truncate text-[11px] text-sidebar-muted">{ROLE_LABELS[role] ?? role.replace("_", " ")}</p>
                  </div>
                )}
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">{accountItem.label}</TooltipContent>
          </Tooltip>
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onSignOut}
                aria-label="Abmelden"
                className="h-10 w-10 md:h-8 md:w-8 shrink-0 text-sidebar-muted hover:bg-destructive/15 hover:text-destructive"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Abmelden</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </aside>
  );
}
