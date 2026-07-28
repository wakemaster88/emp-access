"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { AlertCircle, ArrowDownToLine, ArrowUpFromLine, Timer } from "lucide-react";
import {
  DEFAULT_COVER_RUNTIME_SEC,
  MAX_COVER_CHANNEL,
  MAX_COVER_RUNTIME_SEC,
  coverActionLabels,
} from "@/lib/cover-constants";

export interface CoverFormValues {
  /// Kanalindex als String, damit sich das Feld leeren laesst ("" = nicht gesetzt).
  coverUpChannel: string;
  coverDownChannel: string;
  coverRuntimeSec: string;
}

export const EMPTY_COVER_VALUES: CoverFormValues = {
  coverUpChannel: "0",
  coverDownChannel: "1",
  coverRuntimeSec: String(DEFAULT_COVER_RUNTIME_SEC),
};

/**
 * Prueft die Kanalzuordnung so, wie es auch der Server tut. Liefert eine
 * Fehlermeldung oder null.
 */
export function validateCoverValues(values: CoverFormValues): string | null {
  const up = Number(values.coverUpChannel);
  const down = Number(values.coverDownChannel);
  if (!Number.isInteger(up) || !Number.isInteger(down)) {
    return "Bitte für beide Fahrtrichtungen einen Kanal wählen.";
  }
  if (up === down) {
    return "Auf und Zu müssen auf unterschiedlichen Kanälen liegen – sonst lässt sich nicht verhindern, dass beide Relais gleichzeitig anziehen.";
  }
  const runtime = Number(values.coverRuntimeSec);
  if (!Number.isFinite(runtime) || runtime <= 0 || runtime > MAX_COVER_RUNTIME_SEC) {
    return `Die Fahrzeit muss zwischen 1 und ${MAX_COVER_RUNTIME_SEC} Sekunden liegen.`;
  }
  return null;
}

/** Aus den Formularwerten das JSON fuer die API bauen. */
export function coverPayload(values: CoverFormValues) {
  return {
    coverUpChannel: Number(values.coverUpChannel),
    coverDownChannel: Number(values.coverDownChannel),
    coverRuntimeSec: Number(values.coverRuntimeSec),
  };
}

const CHANNELS = Array.from({ length: MAX_COVER_CHANNEL + 1 }, (_, i) => i);

interface Props {
  category: string;
  values: CoverFormValues;
  onChange: (patch: Partial<CoverFormValues>) => void;
}

export function CoverFields({ category, values, onChange }: Props) {
  const labels = coverActionLabels(category);
  const error = validateCoverValues(values);

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-3">
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Antrieb</p>
      <p className="text-xs text-slate-500">
        Zwei getrennte Relais am selben Shelly – ein Kanal je Fahrtrichtung. Die
        Steuerung schaltet vor jeder Fahrt zuerst die Gegenrichtung ab.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs flex items-center gap-1.5">
            <ArrowUpFromLine className="h-3.5 w-3.5" /> Kanal {labels.open}
          </Label>
          <Select
            value={values.coverUpChannel}
            onValueChange={(v) => onChange({ coverUpChannel: v })}
          >
            <SelectTrigger><SelectValue placeholder="Kanal" /></SelectTrigger>
            <SelectContent>
              {CHANNELS.map((c) => (
                <SelectItem key={c} value={String(c)}>Kanal {c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs flex items-center gap-1.5">
            <ArrowDownToLine className="h-3.5 w-3.5" /> Kanal {labels.close}
          </Label>
          <Select
            value={values.coverDownChannel}
            onValueChange={(v) => onChange({ coverDownChannel: v })}
          >
            <SelectTrigger><SelectValue placeholder="Kanal" /></SelectTrigger>
            <SelectContent>
              {CHANNELS.map((c) => (
                <SelectItem key={c} value={String(c)}>Kanal {c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="d-cover-runtime" className="text-xs flex items-center gap-1.5">
          <Timer className="h-3.5 w-3.5" /> Fahrzeit in Sekunden
        </Label>
        <Input
          id="d-cover-runtime"
          type="number"
          min={1}
          max={MAX_COVER_RUNTIME_SEC}
          value={values.coverRuntimeSec}
          onChange={(e) => onChange({ coverRuntimeSec: e.target.value })}
          className="font-mono"
        />
        <p className="text-xs text-slate-400">
          Wie lange der Antrieb für eine volle Fahrt braucht, plus etwas Reserve.
          Der Shelly schaltet das Relais nach dieser Zeit selbst ab – auch wenn
          die Verbindung zwischendurch abreißt.
        </p>
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
