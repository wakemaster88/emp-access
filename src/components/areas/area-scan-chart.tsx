"use client";

/**
 * Balkendiagramm der Scans einer Ressource (heute je Stunde bzw. letzte
 * 7 Tage). Eigene Datei, damit `area-detail-view` recharts erst nachlädt.
 */

import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

// Diagramm nur aus Tokens (docs/design-regeln.md, Abschnitt 15), wie die Drehkreuz-Karte im Dashboard.
const CHART_TOOLTIP_STYLE = {
  backgroundColor: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: "12px",
  fontSize: "12px",
  color: "var(--popover-foreground)",
  padding: "6px 10px",
};

export function AreaScanChart({
  range,
  data,
}: {
  range: "day" | "week";
  data: Array<Record<string, string | number>>;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey={range === "day" ? "hour" : "label"}
          tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
          tickLine={false}
          axisLine={false}
          interval={range === "day" ? 1 : 0}
        />
        <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip contentStyle={CHART_TOOLTIP_STYLE} cursor={{ fill: "var(--primary)", fillOpacity: 0.08 }} />
        <Bar dataKey={range === "day" ? "granted" : "rides"} name="Gültig" stackId="a" fill="var(--success)" isAnimationActive={false} />
        <Bar dataKey="denied" name="Abgelehnt" stackId="a" fill="var(--destructive)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
