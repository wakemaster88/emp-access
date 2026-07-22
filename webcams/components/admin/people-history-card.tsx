"use client";

import { useEffect, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Calendar, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Historie der Crossing-Counter pro Cam.
 *
 * Zeigt die letzten N Tage als kleine Säulendiagramm (rein vs. raus) plus
 * eine Tabelle. Holt sich die Daten über `/api/counters/[id]/history`.
 *
 * Im Cam-Edit-Form sichtbar, sobald die Cam im Crossing-Modus ist —
 * der User sieht direkt, ob die Konfiguration sinnvolle Zahlen liefert.
 */

interface DayBucket {
  date: string;
  in: number;
  out: number;
  delta: number;
}

interface PeopleHistoryCardProps {
  camId: string;
  /** Anzahl Tage zurück. Default: 14. */
  days?: number;
}

function formatDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}

function formatWeekday(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("de-DE", { weekday: "short" });
}

export function PeopleHistoryCard({ camId, days = 14 }: PeopleHistoryCardProps) {
  const [data, setData] = useState<DayBucket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!camId) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/counters/${encodeURIComponent(camId)}/history?days=${days}`, {
      cache: "no-store",
    })
      .then(async (r) => {
        const j = (await r.json()) as { days?: DayBucket[]; error?: string };
        if (cancelled) return;
        if (!r.ok) {
          setError(j.error ?? `HTTP ${r.status}`);
          setData([]);
        } else {
          setError(null);
          setData(j.days ?? []);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setError((e as Error).message);
        setData([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [camId, days, tick]);

  const max = data?.reduce((m, d) => Math.max(m, d.in, d.out), 0) ?? 0;
  const totalIn = data?.reduce((s, d) => s + d.in, 0) ?? 0;
  const totalOut = data?.reduce((s, d) => s + d.out, 0) ?? 0;
  const today = data?.[data.length - 1];

  return (
    <div className="rounded-lg bg-tile-accent p-3 ring-1 ring-border">
      <div className="mb-2 flex items-center gap-2">
        <Calendar className="size-4 text-foreground/60" />
        <span className="text-xs font-medium uppercase tracking-wider text-foreground/60">
          Historie · letzte {days} Tage
        </span>
        <span className="ml-auto flex items-center gap-3 text-xs">
          {today && (
            <span className="text-foreground/60">
              heute:&nbsp;
              <span className="text-emerald-300">+{today.in}</span>
              &nbsp;/&nbsp;
              <span className="text-rose-300">-{today.out}</span>
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setTick((t) => t + 1)}
            disabled={loading}
            title="Neu laden"
          >
            <RefreshCw className={loading ? "size-3 animate-spin" : "size-3"} />
          </Button>
        </span>
      </div>

      {error && (
        <p className="rounded bg-amber-500/10 px-2 py-1 text-xs text-amber-300">
          {error}
        </p>
      )}

      {data && data.length > 0 ? (
        <>
          <div
            className="grid items-end gap-1"
            style={{
              gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))`,
              height: "92px",
            }}
            aria-label="Säulendiagramm Personen pro Tag"
          >
            {data.map((d) => {
              const inH = max > 0 ? Math.round((d.in / max) * 80) : 0;
              const outH = max > 0 ? Math.round((d.out / max) * 80) : 0;
              return (
                <div
                  key={d.date}
                  className="flex h-full flex-col items-center justify-end"
                  title={`${d.date} · in ${d.in} · out ${d.out} · Δ ${d.delta}`}
                >
                  <div className="flex items-end gap-[2px]">
                    <div
                      className="w-2 rounded-t bg-emerald-400/80"
                      style={{ height: `${inH}px`, minHeight: d.in > 0 ? "2px" : 0 }}
                    />
                    <div
                      className="w-2 rounded-t bg-rose-400/80"
                      style={{ height: `${outH}px`, minHeight: d.out > 0 ? "2px" : 0 }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div
            className="mt-1 grid gap-1 text-[10px] tabular-nums text-foreground/50"
            style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))` }}
          >
            {data.map((d) => (
              <div key={`${d.date}-l`} className="text-center leading-tight">
                <div>{formatDay(d.date)}</div>
                <div className="text-foreground/40">{formatWeekday(d.date)}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-2 text-xs text-foreground/70">
            <span className="flex items-center gap-1">
              <ArrowDownLeft className="size-3 text-emerald-300" />
              <span className="text-emerald-300">{totalIn}</span>
              <span className="text-foreground/50">rein gesamt</span>
            </span>
            <span className="flex items-center gap-1">
              <ArrowUpRight className="size-3 text-rose-300" />
              <span className="text-rose-300">{totalOut}</span>
              <span className="text-foreground/50">raus gesamt</span>
            </span>
            <span className="text-foreground/50">
              Δ&nbsp;
              <span
                className={
                  totalIn - totalOut >= 0 ? "text-emerald-300" : "text-rose-300"
                }
              >
                {totalIn - totalOut >= 0 ? "+" : ""}
                {totalIn - totalOut}
              </span>
            </span>
          </div>
        </>
      ) : !error ? (
        <p className="text-xs text-foreground/50">
          Noch keine Daten. Sobald jemand die Linie quert wird hier eine Säule
          erscheinen.
        </p>
      ) : null}
    </div>
  );
}
