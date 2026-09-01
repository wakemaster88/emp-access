"use client";

import { useEffect, useState } from "react";
import { Car } from "lucide-react";

interface DayRow {
  date: string;
  samples: number;
  avgOccupied: number;
  peakOccupied: number;
  total: number;
  occupancy: number;
}

interface HourRow {
  hour: number;
  samples: number;
  avgOccupied: number;
  total: number;
  occupancy: number;
}

interface ParkingHistoryCardProps {
  camId: string;
}

function formatDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}

export function ParkingHistoryCard({ camId }: ParkingHistoryCardProps) {
  const [days, setDays] = useState<DayRow[] | null>(null);
  const [hours, setHours] = useState<HourRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!camId) return;
    let cancelled = false;
    fetch(`/api/counters/${encodeURIComponent(camId)}/parking?days=14`, {
      cache: "no-store",
    })
      .then(async (r) => {
        const j = (await r.json()) as {
          days?: DayRow[];
          hours?: HourRow[];
          error?: string;
        };
        if (cancelled) return;
        if (!r.ok) {
          setError(j.error ?? `HTTP ${r.status}`);
          setDays([]);
          setHours([]);
        } else {
          setError(null);
          setDays(j.days ?? []);
          setHours(j.hours ?? []);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setError((e as Error).message);
        setDays([]);
        setHours([]);
      });
    return () => {
      cancelled = true;
    };
  }, [camId]);

  const peakHour = hours?.reduce(
    (best, h) => (h.occupancy > (best?.occupancy ?? -1) ? h : best),
    null as HourRow | null,
  );
  const maxOcc = Math.max(0.01, ...(hours ?? []).map((h) => h.occupancy));

  return (
    <div className="rounded-md border border-foreground/10 p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        <Car className="size-4 opacity-70" />
        Belegung (heute + 14 Tage)
      </div>
      {error && (
        <p className="text-xs text-foreground/50">
          Noch keine Auswertung ({error.replace(/^tracker offline: /, "")}).
        </p>
      )}
      {hours && hours.some((h) => h.samples > 0) && (
        <div className="mb-3">
          <div className="mb-1 text-xs text-foreground/60">Heute nach Stunde</div>
          <div className="flex h-16 items-end gap-px">
            {hours.map((h) => (
              <div
                key={h.hour}
                className="flex-1 rounded-t bg-emerald-400/80"
                style={{ height: `${Math.max(4, (h.occupancy / maxOcc) * 100)}%` }}
                title={`${String(h.hour).padStart(2, "0")}:00 · ${Math.round(h.occupancy * 100)} % belegt`}
              />
            ))}
          </div>
          {peakHour && peakHour.samples > 0 && (
            <p className="mt-1 text-xs text-foreground/60">
              Peak {String(peakHour.hour).padStart(2, "0")}:00 ·{" "}
              {Math.round(peakHour.occupancy * 100)} %
            </p>
          )}
        </div>
      )}
      {days && days.some((d) => d.samples > 0) && (
        <table className="w-full text-xs">
          <thead className="text-foreground/50">
            <tr>
              <th className="py-1 text-left font-medium">Tag</th>
              <th className="py-1 text-right font-medium">Ø belegt</th>
              <th className="py-1 text-right font-medium">Peak</th>
              <th className="py-1 text-right font-medium">Auslastung</th>
            </tr>
          </thead>
          <tbody>
            {days
              .filter((d) => d.samples > 0)
              .map((d) => (
                <tr key={d.date} className="border-t border-foreground/5">
                  <td className="py-1">{formatDay(d.date)}</td>
                  <td className="py-1 text-right tabular-nums">
                    {d.avgOccupied.toFixed(1)} / {d.total}
                  </td>
                  <td className="py-1 text-right tabular-nums">{d.peakOccupied}</td>
                  <td className="py-1 text-right tabular-nums">
                    {Math.round(d.occupancy * 100)} %
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
