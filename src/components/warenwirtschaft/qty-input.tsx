"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type Field = "counted" | "broken";

function toInput(v: number | null): string {
  return v == null ? "" : v.toLocaleString("de-DE", { maximumFractionDigits: 3, useGrouping: false });
}

/** Zahlenfeld einer Zählzeile: übernimmt beim Verlassen, Enter springt weiter. */
export function QtyInput({
  value,
  onCommit,
  label,
  field,
  invalid,
  placeholder,
  className,
}: {
  field: Field;
  value: number | null;
  onCommit: (raw: string) => void;
  label: string;
  invalid?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Input
      inputMode="decimal"
      enterKeyHint="next"
      aria-label={label}
      placeholder={placeholder}
      aria-invalid={invalid || undefined}
      value={draft ?? toInput(value)}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null) onCommit(draft);
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        // Weiter zum gleichen Feld der nächsten sichtbaren Zeile (Ist → Ist, Bruch → Bruch).
        const field = e.currentTarget.dataset.countInput;
        const inputs = [...document.querySelectorAll<HTMLInputElement>(`input[data-count-input="${field}"]`)].filter((el) => el.offsetParent !== null);
        const next = inputs[inputs.indexOf(e.currentTarget) + 1];
        if (next) next.focus();
        else e.currentTarget.blur();
      }}
      data-count-input={field}
      className={cn("h-11 px-2 text-right tabular-nums sm:h-9", className)}
    />
  );
}
