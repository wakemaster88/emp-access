"use client";

import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  OPERATING_EXTENTS,
  OPERATING_EXTENT_LABELS,
  isOperatingExtent,
  type OperatingExtentKind,
} from "@/lib/operating-extent";

const HINTS: Record<OperatingExtentKind, string> = {
  SELF: "Nur zum öffentlichen Betrieb des Bereichs.",
  BOOKED_SUBPROFILES:
    "Zusätzlich, sobald in anny eine Bahnmiete oder ein Kurs gebucht ist, und nur in dessen Zeiten.",
  SUBPROFILES: "Zusätzlich zu allen Zeiten der Bahnmieten und Kurse, auch ohne Buchung.",
};

/**
 * Auswahl, ob eine Automation auch zu Bahnmieten und Kursen (Unterprofilen)
 * laeuft. Nur sinnvoll, wenn die Betriebszeit Unterprofile hat; die Dialoge
 * blenden sie sonst aus, ausser es ist schon etwas anderes als „Nur
 * Betriebszeit“ gewaehlt.
 */
export function OperatingExtentSelect({
  value,
  onChange,
  disabled,
  label = "Auch zu Bahnmieten und Kursen",
}: {
  value: OperatingExtentKind;
  onChange: (v: OperatingExtentKind) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <Label className="text-xs">{label}</Label>
      <NativeSelect
        disabled={disabled}
        value={value}
        onChange={(e) => {
          if (isOperatingExtent(e.target.value)) onChange(e.target.value);
        }}
      >
        {OPERATING_EXTENTS.map((k) => (
          <option key={k} value={k}>
            {OPERATING_EXTENT_LABELS[k]}
          </option>
        ))}
      </NativeSelect>
      <p className="text-[11px] text-muted-foreground">{HINTS[value]}</p>
    </div>
  );
}
