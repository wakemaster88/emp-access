import { CalendarCheck, Users } from "lucide-react";
import { SegmentedLinks } from "@/components/ui/segmented-links";

/** Umschalter zwischen Vereinsliste und Vereinsbuchungen (Abrechnung). */
export function VereineTabs({ value, openCount }: { value: "vereine" | "buchungen"; openCount?: number }) {
  return (
    <SegmentedLinks
      aria-label="Vereine"
      value={value}
      options={[
        { value: "vereine", label: "Vereine", icon: Users, href: "/vereine" },
        {
          value: "buchungen",
          label: "Buchungen",
          icon: CalendarCheck,
          href: "/vereine/buchungen",
          ...(openCount ? { count: openCount } : {}),
        },
      ]}
    />
  );
}
