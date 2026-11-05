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

  // Wie `Segmented` (Glas-Kapsel, helle Pille), aber mit Links: der Filter steht in der URL.
  // Die Gruppe trägt ihren Namen wie `Segmented` (aria-label).
  return (
    <div
      role="group"
      aria-label="Status"
      className="glass-strip inline-flex max-w-full items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {OPTIONS.map(({ value, label }) => {
        const isActive = current === value;
        const href = value === "active" ? pathname : `${pathname}?status=${value}`;
        return (
          <Link
            key={value}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "press inline-flex h-[34px] shrink-0 items-center justify-center rounded-full px-3.5 text-[13px] whitespace-nowrap outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              isActive
                ? "glass-pill-active font-semibold text-foreground"
                : "font-medium text-muted-foreground hover:text-foreground"
            )}
          >
            {label}
          </Link>
        );
      })}
    </div>
  );
}
