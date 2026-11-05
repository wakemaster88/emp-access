"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
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
    // Gruppe im Dialog als Glas-Kachel (glass-tile, Radius 18 px); in der Ebene getönt (Abschnitt 18).
    <div className="glass-tile p-3 space-y-3">
      <p className="text-label">Taster</p>
      <p className="text-xs text-muted-foreground">
        Ein Druck schaltet das Relais ein; nach der eingestellten Dauer fällt es
        von selbst wieder ab. Den Timer übernimmt der Shelly – das Relais geht
        also auch dann wieder aus, wenn die Verbindung zwischendurch abreißt.
      </p>

      <div className="space-y-1.5">
        <Label htmlFor="d-pulse-seconds" className="flex items-center gap-1.5">
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
              className="press inline-flex h-9 items-center rounded-full border border-border px-3 text-xs text-muted-foreground tabular-nums hover:border-primary/60 hover:text-primary max-sm:h-11"
            >
              {formatPulseDuration(s)}
            </button>
          ))}
        </div>
        {!error && (
          <p className="text-xs text-muted-foreground">
            Betätigen schaltet für {formatPulseDuration(seconds)} ein.
          </p>
        )}
      </div>

      {error && <Notice tone="warning" compact icon={AlertCircle} title={error} />}
    </div>
  );
}
