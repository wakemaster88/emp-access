"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, Timer } from "lucide-react";
import {
  DEFAULT_PULSE_SECONDS,
  MAX_PULSE_SECONDS,
  formatPulseDuration,
} from "@/lib/pulse-constants";

export interface PulseFormValues {
  /// Sekunden als String, damit sich das Feld beim Tippen leeren laesst.
  pulseSeconds: string;
}

export const EMPTY_PULSE_VALUES: PulseFormValues = {
  pulseSeconds: String(DEFAULT_PULSE_SECONDS),
};

/** Prueft die Einschaltdauer so, wie es auch der Server tut. */
export function validatePulseValues(values: PulseFormValues): string | null {
  const seconds = Number(values.pulseSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_PULSE_SECONDS) {
    return `Die Einschaltdauer muss zwischen 1 und ${MAX_PULSE_SECONDS} Sekunden liegen.`;
  }
  return null;
}

export function pulsePayload(values: PulseFormValues) {
  return { pulseSeconds: Number(values.pulseSeconds) };
}

const PRESETS = [15, 30, 60, 120, 300];

interface Props {
  values: PulseFormValues;
  onChange: (patch: Partial<PulseFormValues>) => void;
}

export function PulseFields({ values, onChange }: Props) {
  const error = validatePulseValues(values);
  const seconds = Number(values.pulseSeconds);

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-3">
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Taster</p>
      <p className="text-xs text-slate-500">
        Ein Druck schaltet das Relais ein; nach der eingestellten Dauer fällt es
        von selbst wieder ab. Den Timer übernimmt der Shelly – das Relais geht
        also auch dann wieder aus, wenn die Verbindung zwischendurch abreißt.
      </p>

      <div className="space-y-1.5">
        <Label htmlFor="d-pulse-seconds" className="text-xs flex items-center gap-1.5">
          <Timer className="h-3.5 w-3.5" /> Einschaltdauer in Sekunden
        </Label>
        <Input
          id="d-pulse-seconds"
          type="number"
          min={1}
          max={MAX_PULSE_SECONDS}
          value={values.pulseSeconds}
          onChange={(e) => onChange({ pulseSeconds: e.target.value })}
          className="font-mono"
        />
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onChange({ pulseSeconds: String(s) })}
              className="rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 text-xs text-slate-500 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
            >
              {formatPulseDuration(s)}
            </button>
          ))}
        </div>
        {!error && (
          <p className="text-xs text-slate-400">
            Betätigen schaltet für {formatPulseDuration(seconds)} ein.
          </p>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
