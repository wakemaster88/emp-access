"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ChevronDown, LogOut, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  accountItem,
  adminItems,
  isNavItemActive,
  navGroups,
  type NavGroup,
  type NavItem,
} from "@/components/layout/nav-config";
import { filterNavGroups, firstNavMatch } from "@/lib/nav-search";

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
  const router = useRouter();
  const isSuperAdmin = role === "SUPER_ADMIN";
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const navId = useId();
  const searching = query.trim() !== "";
  const visibleGroups = filterNavGroups(navGroups, query);

  /*
   * Beim Laden und bei jedem Seitenwechsel die Gruppe der Seite aufklappen, damit man sieht,
   * wo man ist. Im Render statt im Effekt (Zustand aus vorherigem Render),
   * gespeichert wird nur, wenn sich wirklich etwas ändert.
   */
  const [lastPathname, setLastPathname] = useState<string | null>(null);
  if (lastPathname !== pathname) {
    setLastPathname(pathname);
    const active = navGroups.find((g) => g.items.some((item) => isNavItemActive(pathname, item.href)));
    if (active && collapsedGroups[active.key]) {
      const next = { ...collapsedGroups, [active.key]: false };
      setCollapsedGroups(next);
      saveCollapsedGroups(next);
    }
  }

  // Strg/Cmd+K springt am Desktop in die Suche (klappt eine schmale Leiste dafür auf).
  useEffect(() => {
    if (inSheet || isSuperAdmin) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (readCollapsed()) writeCollapsed(false);
        requestAnimationFrame(() => searchRef.current?.focus());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inSheet, isSuperAdmin]);

  const clearSearch = useCallback(() => setQuery(""), []);

  const onSearchKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const hit = firstNavMatch(visibleGroups, query);
      if (!hit) return;
      e.preventDefault();
      setQuery("");
      router.push(hit.href);
      onNavigate?.();
    } else if (e.key === "Escape" && query) {
      e.preventDefault();
      e.stopPropagation();
      setQuery("");
    }
  };

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
        onClick={() => {
          setQuery("");
          onNavigate?.();
        }}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          "press group relative flex items-center gap-3 rounded-md text-sm font-medium outline-none",
          "focus-visible:ring-2 focus-visible:ring-sidebar-ring/60",
          collapsed ? "h-10 w-10 justify-center mx-auto" : "px-3 py-2",
          // Aktiv: getönte Glas-Pille in Akzentfarbe mit Lichtkante, wie im Mockup.
          isActive
            ? "bg-sidebar-primary/[0.16] font-semibold text-sidebar-accent-foreground shadow-[inset_0_1px_0_var(--glass-highlight)]"
            : "text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground",
        )}
      >
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
    // Beim Suchen sind alle Treffergruppen offen, ohne den gemerkten Zustand zu ändern.
    const isOpen = searching || !collapsedGroups[group.key];
    const hasActive = group.items.some((item) => isNavItemActive(pathname, item.href));

    if (collapsed) {
      return (
        <div className={cn("space-y-1", !isFirst && "pt-2 mt-2 border-t border-sidebar-foreground/[0.08]")}>
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
          disabled={searching}
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
          {!searching && <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", !isOpen && "-rotate-90")} />}
        </button>
        {isOpen && group.items.map((item) => <NavLink key={item.href} {...item} />)}
      </div>
    );
  };

  const accountActive = isNavItemActive(pathname, accountItem.href);

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 shrink-0 flex-col text-sidebar-foreground",
        // Am Desktop eine Glasfläche über dem Farbgrund; im Handy-Menü trägt das Sheet das Glas.
        !inSheet && "bg-sidebar backdrop-blur-2xl backdrop-saturate-[1.7] border-r border-sidebar-border transition-[width] duration-300",
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
          <Image src="/logo.png" alt="EMP Access" width={28} height={28} className="shrink-0 dark:hidden" />
          <Image src="/logo-dark.png" alt="EMP Access" width={28} height={28} className="hidden shrink-0 dark:block" />
          {!collapsed && (
            <span className="flex flex-col leading-none">
              <span className="text-[15px] font-semibold tracking-tight text-sidebar-accent-foreground">EMP Access</span>
              <span className="mt-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-sidebar-muted">
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
            className="h-8 w-8 shrink-0 rounded-full text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            aria-label="Seitenleiste einklappen"
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="mx-3 h-px bg-sidebar-foreground/[0.08]" />

      {/* Suche über alle Module: Name, Bereich und Stichworte. Enter öffnet den ersten Treffer. */}
      {!isSuperAdmin && !collapsed && (
        <div className="px-3 pt-3">
          <SearchInput
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onClear={clearSearch}
            onKeyDown={onSearchKeyDown}
            placeholder="Modul suchen"
            aria-label="Modul suchen"
            aria-controls={navId}
            enterKeyHint="go"
            autoComplete="off"
            className="h-11 md:h-9"
          />
        </div>
      )}

      <nav
        id={navId}
        aria-label="Module" className={cn("flex-1 min-h-0 overflow-y-auto overscroll-contain py-3 scrollbar-thin", collapsed ? "px-2" : "px-3")}>
        {isSuperAdmin ? (
          <div className="space-y-1">
            {adminItems.map((item) => (
              <NavLink key={item.href} {...item} />
            ))}
          </div>
        ) : visibleGroups.length === 0 ? (
          <p className="px-3 py-2 text-sm text-sidebar-muted" role="status">
            Kein Modul passt zu „{query.trim()}“.
          </p>
        ) : (
          visibleGroups.map((group, idx) => (
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
                className="h-10 w-10 mx-auto flex rounded-full text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                aria-label="Seitenleiste erweitern"
              >
                <PanelLeftOpen className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Erweitern</TooltipContent>
          </Tooltip>
        </div>
      )}

      <div className="mx-3 h-px bg-sidebar-foreground/[0.08]" />

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
                  "flex items-center gap-3 rounded-md min-w-0 transition-colors outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring/60",
                  collapsed ? "p-1" : "flex-1 px-2 py-1.5",
                  accountActive && "bg-sidebar-primary/[0.16] shadow-[inset_0_1px_0_var(--glass-highlight)]",
                )}
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-chart-5 text-sm font-semibold text-white shadow-[inset_0_1px_0_oklch(1_0_0/30%)] ring-2 ring-white/40 dark:ring-white/10">
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
                className="h-10 w-10 md:h-8 md:w-8 shrink-0 rounded-full text-sidebar-muted hover:bg-destructive/15 hover:text-destructive"
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
