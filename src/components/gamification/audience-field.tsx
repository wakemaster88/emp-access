"use client";

import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";
import { AUDIENCE_LABEL, PASS_AUDIENCES, type PassAudience } from "@/lib/rider-pass";

/**
 * „Für“: Ride Pass, Beach Pass oder beide. Erscheint nur, wenn der Beach Pass
 * eingeschaltet ist; sonst gilt alles wie bisher für den Ride Pass.
 */
export function AudienceField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: PassAudience;
  onChange: (v: PassAudience) => void;
}) {
  return (
    <div className="space-y-1.5 min-w-0">
      <Label id={id}>Für</Label>
      <Segmented
        aria-label="Für welchen Pass"
        value={value}
        onValueChange={onChange}
        stretch
        options={PASS_AUDIENCES.map((a) => ({ value: a, label: a === "ALL" ? "Beide" : AUDIENCE_LABEL[a] }))}
      />
    </div>
  );
}

/** Kurzer Hinweis in Listen, wenn ein Eintrag nicht nur für den Ride Pass gilt. */
export function audienceBadgeText(audience: PassAudience | undefined): string | null {
  return audience === "BEACH" ? "Beach Pass" : audience === "ALL" ? "Beide Pässe" : null;
}
