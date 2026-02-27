"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export type DeviceStatusFilterValue = "active" | "inactive" | "all";

const OPTIONS: { value: DeviceStatusFilterValue; label: string }[] = [
  { value: "active", label: "Aktive" },
  { value: "inactive", label: "Inaktive" },
  { value: "all", label: "Alle" },
];

interface DeviceStatusFilterProps {
  current: DeviceStatusFilterValue;
}

export function DeviceStatusFilter({ current }: DeviceStatusFilterProps) {
  const pathname = usePathname();

  return (
    <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/50 p-0.5">
      {OPTIONS.map(({ value, label }) => {
        const isActive = current === value;
        const href = value === "active" ? pathname : `${pathname}?status=${value}`;
        return (
          <Link
            key={value}
            href={href}
            className={cn(
              "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
              isActive
                ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
            )}
          >
            {label}
          </Link>
        );
      })}
    </div>
  );
}
