"use client";

import { usePathname } from "next/navigation";
import { SegmentedLinks } from "@/components/ui/segmented-links";

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

  // Segmentwahl mit Links (SegmentedLinks): der Filter steht in der URL.
  return (
    <SegmentedLinks
      aria-label="Status"
      value={current}
      options={OPTIONS.map(({ value, label }) => ({
        value,
        label,
        href: value === "active" ? pathname : `${pathname}?status=${value}`,
      }))}
    />
  );
}
