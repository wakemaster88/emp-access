"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  Ticket,
  HardDrive,
  MapPin,
  ScanLine,
  Monitor,
  ChevronLeft,
  ChevronRight,
  Shield,
  LogOut,
  Settings,
  CreditCard,
  Package,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/tickets", label: "Tickets", icon: Ticket },
  { href: "/subscriptions", label: "Abos", icon: CreditCard },
  { href: "/services", label: "Services", icon: Package },
  { href: "/devices", label: "Geräte", icon: HardDrive },
  { href: "/areas", label: "Resourcen", icon: MapPin },
  { href: "/scans", label: "Scans", icon: ScanLine },
  { href: "/monitor", label: "Live Monitor", icon: Monitor },
  { href: "/settings", label: "Einstellungen", icon: Settings },
];

const adminItems = [
  { href: "/admin", label: "Admin Dashboard", icon: Shield },
  { href: "/admin/accounts", label: "Mandanten", icon: LayoutDashboard },
];

interface SidebarProps {
  userName: string;
  role: string;
  onSignOut: () => void;
  onNavigate?: () => void;
}

export function Sidebar({ userName, role, onSignOut, onNavigate }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const isSuperAdmin = role === "SUPER_ADMIN";

  const NavLink = ({ href, label, icon: Icon }: { href: string; label: string; icon: React.ComponentType<{ className?: string }> }) => {
    const isActive = pathname === href || (href !== "/" && pathname.startsWith(href));

    const link = (
      <Link
        href={href}
        onClick={onNavigate}
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

  return (
    <aside
      className={cn(
        "flex flex-col min-h-full bg-slate-900 border-r border-slate-800 transition-all duration-300 shrink-0",
        collapsed ? "w-16" : "w-64"
      )}
    >
      <div className="flex items-center justify-between p-3 md:p-4">
        {!collapsed && (
          <Link href={isSuperAdmin ? "/admin" : "/"} className="flex items-center gap-2" onClick={onNavigate}>
            <div className="h-8 w-8 rounded-lg bg-indigo-600 flex items-center justify-center shrink-0">
              <Shield className="h-5 w-5 text-white" />
            </div>
            <span className="text-lg font-bold text-white">EMP Access</span>
          </Link>
        )}
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

      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {isSuperAdmin
          ? adminItems.map((item) => (
              <NavLink key={item.href} {...item} />
            ))
          : navItems.map((item) => (
              <NavLink key={item.href} {...item} />
            ))
        }
      </nav>

      <Separator className="bg-slate-800" />

      <div className="p-3">
        <div className={cn("flex items-center gap-3", collapsed ? "justify-center" : "px-3 py-2")}>
          <div className="h-8 w-8 rounded-full bg-indigo-600 flex items-center justify-center text-white text-sm font-bold shrink-0">
            {userName.charAt(0).toUpperCase()}
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-200 truncate">{userName}</p>
              <p className="text-xs text-slate-500">{role.replace("_", " ")}</p>
            </div>
          )}
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onSignOut}
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
