"use client";

import type { RefObject } from "react";
import { Delete, KeyRound, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SHOP_COST_PIN_MAX_LENGTH } from "@/lib/shop-scan";

const PIN_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "del", "0", "ok"] as const;

/**
 * Ziffernfeld für die PIN im Shop-Monitor (EK und Marge, Angebot mit Rabatt):
 * große Tasten für den Touch-Monitor, die Tastatur geht auch.
 */
export function ShopPinPad({
  title,
  value,
  onChange,
  onSubmit,
  onCancel,
  busy,
  error,
  hint,
  inputRef,
}: {
  title: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  busy: boolean;
  error: string | null;
  hint: string;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const press = (key: (typeof PIN_KEYS)[number]) => {
    if (key === "ok") onSubmit();
    else if (key === "del") onChange(value.slice(0, -1));
    else if (value.length < SHOP_COST_PIN_MAX_LENGTH) onChange(value + key);
  };
  return (
    <div className="mx-auto max-w-sm space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-foreground flex items-center gap-2">
          <KeyRound className="size-4 text-primary" />
          {title}
        </p>
        <Button variant="ghost" onClick={onCancel} className="h-11 text-muted-foreground">
          Abbrechen
        </Button>
      </div>
      <Input
        ref={inputRef}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={SHOP_COST_PIN_MAX_LENGTH}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, SHOP_COST_PIN_MAX_LENGTH))}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); onSubmit(); }
          if (e.key === "Escape") { e.stopPropagation(); onCancel(); }
        }}
        aria-label="PIN"
        aria-invalid={!!error}
        placeholder="PIN"
        className="h-14 text-center text-2xl tracking-[0.5em] tabular-nums md:text-2xl"
      />
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Ziffern">
        {PIN_KEYS.map((key) => (
          <Button
            key={key}
            variant={key === "ok" ? "default" : "outline"}
            onClick={() => press(key)}
            disabled={busy || (key === "ok" && value.length === 0)}
            aria-label={key === "del" ? "Ziffer löschen" : key === "ok" ? "PIN bestätigen" : key}
            className="h-12 text-lg font-semibold tabular-nums sm:h-14"
          >
            {key === "del" ? <Delete className="size-5" /> : key === "ok" ? (busy ? <Loader2 className="size-5 animate-spin" /> : "OK") : key}
          </Button>
        ))}
      </div>
      <p role={error ? "alert" : undefined} className={cn("min-h-4 text-xs", error ? "text-destructive" : "text-muted-foreground")}>
        {error ?? hint}
      </p>
    </div>
  );
}
