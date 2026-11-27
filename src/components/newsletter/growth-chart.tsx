"use client";

/**
 * Angemeldete Abonnenten je Woche als Linie (eine Reihe, daher ohne Legende).
 * Tooltip mit Neu und Gegangen der Woche. Farben nur aus Tokens
 * (docs/design-regeln.md, Abschnitt 15).
 */

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface GrowthPoint {
  label: string;
  active: number;
  joined: number;
  left: number;
}

const nf = new Intl.NumberFormat("de-DE");

function GrowthTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: GrowthPoint }> }) {
  const p = active ? payload?.[0]?.payload : null;
  if (!p) return null;
  return (
    <div className="rounded-xl border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-sm">
      <p className="font-medium">Woche bis {p.label}</p>
      <p className="tabular-nums">{nf.format(p.active)} angemeldet</p>
      <p className="tabular-nums text-muted-foreground">
        +{nf.format(p.joined)} neu · −{nf.format(p.left)} gegangen
      </p>
    </div>
  );
}

export function GrowthChart({ data }: { data: GrowthPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
          minTickGap={24}
        />
        <YAxis
          tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
          width={44}
          tickFormatter={(v: number) => nf.format(v)}
        />
        <Tooltip content={<GrowthTooltip />} cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }} />
        <Line
          type="linear"
          dataKey="active"
          name="Angemeldet"
          stroke="var(--chart-1)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
