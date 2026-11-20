import { CalendarDays, Settings2 } from "lucide-react";
import { SegmentedLinks } from "@/components/ui/segmented-links";

/** Umschalter zwischen Belegung und Einstellungen (Räume, Zusatzleistungen, Partner). */
export function VeranstaltungenTabs({ value, isAdmin }: { value: "termine" | "einstellungen"; isAdmin: boolean }) {
  if (!isAdmin) return null;
  return (
    <SegmentedLinks
      aria-label="Veranstaltungen"
      value={value}
      options={[
        { value: "termine", label: "Belegung", icon: CalendarDays, href: "/veranstaltungen" },
        { value: "einstellungen", label: "Einstellungen", icon: Settings2, href: "/veranstaltungen/einstellungen" },
      ]}
    />
  );
}
