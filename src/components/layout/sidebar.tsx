"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useCallback, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
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

interface SidebarProps {
  userName: string;
  role: string;
  onSignOut: () => void;
  onNavigate?: () => void;
}

export function Sidebar({ userName, role, onSignOut, onNavigate }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(loadCollapsedGroups);
  const pathname = usePathname();
  const isSuperAdmin = role === "SUPER_ADMIN";

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
          "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
          "hover:bg-slate-700/50",
          isActive
            ? "bg-indigo-600/20 text-indigo-400 border-l-2 border-indigo-500 -ml-[1px]"
            : "text-slate-400 hover:text-slate-200"
        )}
      >
        <Icon className="h-5 w-5 shrink-0" />
        {!collapsed && <span>{label}</span>}
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
        <div className={cn("space-y-1", !isFirst && "pt-2 mt-2 border-t border-slate-800/70")}>
          {group.items.map((item) => (
            <NavLink key={item.href} {...item} />
          ))}
        </div>
      );
    }

    return (
      <div className={cn("space-y-1", !isFirst && "pt-3 mt-1")}>
        <button
          type="button"
          onClick={() => toggleGroup(group.key)}
          aria-expanded={isOpen}
          className={cn(
            "flex w-full items-center justify-between rounded-md px-3 pb-1.5 pt-1",
            "text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors",
            "text-slate-500/80 hover:text-slate-300"
          )}
        >
          <span className="flex items-center gap-1.5">
            {group.label}
            {/* Zugeklappte Gruppe mit aktiver Seite: Punkt zeigt, wo man gerade ist. */}
            {!isOpen && hasActive && <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" aria-hidden />}
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
        "flex flex-col h-full min-h-0 bg-slate-900 border-r border-slate-800 transition-all duration-300 shrink-0",
        collapsed ? "w-16" : "w-64"
      )}
    >
      <div className={cn("flex items-center p-3 md:p-4", collapsed ? "flex-col gap-2" : "justify-between")}>
        <Link href={isSuperAdmin ? "/admin" : "/"} className={cn("flex items-center gap-2", collapsed && "justify-center w-full")} onClick={onNavigate}>
          <Image src="/logo-dark.png" alt="EMP Access" width={32} height={32} className="shrink-0" />
          {!collapsed && <span className="text-lg font-bold text-white">EMP Access</span>}
        </Link>
        {!onNavigate && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCollapsed(!collapsed)}
            className="text-slate-400 hover:text-white hover:bg-slate-800 h-9 w-9 md:h-8 md:w-8 shrink-0"
            aria-label={collapsed ? "Sidebar erweitern" : "Sidebar einklappen"}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </Button>
        )}
      </div>

      <Separator className="bg-slate-800" />

      <nav className="flex-1 min-h-0 p-3 overflow-y-auto overscroll-contain">
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

      <Separator className="bg-slate-800" />

      {/* Benutzerblock: führt zu Konto & Sicherheit, daneben Abmelden. */}
      <div className="p-3">
        <div className={cn("flex items-center gap-2", collapsed ? "flex-col" : "px-1 py-1")}>
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Link
                href={accountItem.href}
                onClick={onNavigate}
                aria-current={accountActive ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg min-w-0 transition-colors hover:bg-slate-800/70",
                  collapsed ? "p-1" : "flex-1 px-2 py-1.5",
                  accountActive && "bg-indigo-600/20"
                )}
              >
                <div className="h-8 w-8 rounded-full bg-indigo-600 flex items-center justify-center text-white text-sm font-bold shrink-0">
                  {userName.charAt(0).toUpperCase()}
                </div>
                {!collapsed && (
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-200 truncate">{userName}</p>
                    <p className="text-xs text-slate-500">{role.replace("_", " ")}</p>
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
                className="text-slate-400 hover:text-red-400 hover:bg-slate-800 h-10 w-10 min-h-[44px] min-w-[44px] md:h-8 md:w-8 md:min-h-0 md:min-w-0 shrink-0"
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
