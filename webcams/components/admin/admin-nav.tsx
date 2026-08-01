"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  Camera,
  LayoutDashboard,
  LayoutGrid,
  Settings as SettingsIcon,
  Bell,
  ListChecks,
  ScrollText,
  ShieldCheck,
} from "lucide-react";

const items = [
  { href: "/admin", label: "Übersicht", icon: LayoutDashboard, exact: true },
  { href: "/admin/cams", label: "Kameras", icon: Camera },
  { href: "/admin/widgets", label: "Widgets", icon: LayoutGrid },
  { href: "/admin/layouts", label: "Layouts", icon: ListChecks },
  { href: "/admin/doorbird", label: "Doorbird", icon: Bell },
  { href: "/admin/drehkreuz", label: "Drehkreuz", icon: ShieldCheck },
  { href: "/admin/events", label: "Ereignisse", icon: ScrollText },
  { href: "/admin/settings", label: "Einstellungen", icon: SettingsIcon },
];

export function AdminNav() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <nav className="flex flex-col gap-1 p-3">
      {items.map((item) => {
        const Icon = item.icon;
        const active =
          mounted &&
          (item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(item.href + "/"));
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
              active
                ? "bg-tile text-foreground ring-1 ring-border"
                : "text-foreground/70 hover:bg-tile hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
