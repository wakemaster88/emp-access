"use client";

/**
 * Auswertung › Klima: alle Räume mit Fühler, derselbe Zeitraum für alle,
 * je Raum Ist-Werte und der Verlauf (Mockup W16, unterer Teil).
 */

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Flame, Thermometer, TriangleAlert } from "lucide-react";
import { ClimateHistory, RangeStrip, type HistoryRange } from "@/components/raeume/climate-history";
import { useNow } from "@/components/raeume/status";
import { cn } from "@/lib/utils";

export interface KlimaRoom {
  id: number;
  name: string;
  location: string | null;
  climate: {
    isActive: boolean;
    targetC: number;
    currentTargetC: number | null;
    heating: boolean | null;
    fanOn: boolean | null;
    lastTempC: number | null;
    lastHumidity: number | null;
    lastError: string | null;
  } | null;
}

const fmtC = (v: number | null) => (v == null ? "–" : `${v.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} °C`);

export function KlimaClient({ rooms, timezone, renderedAt }: { rooms: KlimaRoom[]; timezone: string; renderedAt: string }) {
  const [range, setRange] = useState<HistoryRange>("day");
  const nowMs = useNow(new Date(renderedAt).getTime());

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/raeume" className="flex h-9 items-center gap-1 rounded-full px-3 text-[12px] font-medium text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" />
          Räume
        </Link>
        <RangeStrip value={range} onChange={setRange} className="ml-auto" />
      </div>

      {rooms.length === 0 ? (
        <section className="glass-card p-5 text-sm text-muted-foreground">
          Noch kein Raum mit Fühler. Ordne einem Raum einen Temperaturfühler zu oder richte unter „Räume“ eine Klimaregelung ein.
        </section>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {rooms.map((r) => {
            const c = r.climate;
            const state = c?.lastError
              ? { text: `Fehler · ${c.lastError}`, tone: "text-destructive", Icon: TriangleAlert }
              : c?.isActive && c.heating
                ? { text: `heizt auf ${(c.currentTargetC ?? c.targetC).toLocaleString("de-DE")} °C`, tone: "text-orange-600 dark:text-orange-400", Icon: Flame }
                : c?.isActive && c.fanOn
                  ? { text: "lüftet", tone: "text-sky-600 dark:text-sky-400", Icon: Thermometer }
                  : c?.isActive
                    ? { text: c.currentTargetC != null ? `Ziel ${c.currentTargetC.toLocaleString("de-DE")} °C` : "Absenkung", tone: "text-muted-foreground", Icon: Thermometer }
                    : { text: c ? "Regelung pausiert" : "nur Fühler", tone: "text-muted-foreground", Icon: Thermometer };
            return (
              <section key={r.id} className="glass-card space-y-3 p-4">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <Link href={`/raeume?raum=${r.id}`} className="block truncate text-sm font-semibold hover:text-primary">
                      {r.name}
                    </Link>
                    {r.location && <p className="truncate text-[11px] text-muted-foreground">{r.location}</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-semibold tabular-nums tracking-tight">{fmtC(c?.lastTempC ?? null)}</p>
                    <p className={cn("flex items-center justify-end gap-1 text-[11px]", state.tone)}>
                      <state.Icon className="h-3 w-3" />
                      {state.text}
                      {c?.lastHumidity != null && <span className="text-muted-foreground"> · {Math.round(c.lastHumidity)} %</span>}
                    </p>
                  </div>
                </div>
                <ClimateHistory roomId={r.id} range={range} timezone={timezone} nowMs={nowMs} />
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
