"use client";

/**
 * Verlaufsdiagramm der Abo-Kennzahlen (Bestand, Neu, Auslauf). Eigene Datei,
 * damit `subscription-stats` recharts erst nachlädt.
 */

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import type { SubscriptionStats as Stats } from "@/lib/subscription-stats";

// Tooltip und Achsen über Design-Tokens, damit Hell und Dunkel gleich gut lesbar sind.
const CHART_TOOLTIP_STYLE = {
  backgroundColor: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: "14px",
  fontSize: "12px",
  color: "var(--popover-foreground)",
  padding: "6px 10px",
};

function fmtMonth(iso: string): string {
  const [, m] = iso.split("-").map(Number);
  return ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"][m - 1] ?? "";
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

export function SubscriptionTimelineChart({
  data,
  tickInterval,
}: {
  data: Stats["timeline"];
  tickInterval: number;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 5, right: 12, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="aboActiveGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.45} />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.05} />
          </linearGradient>
          <linearGradient id="aboNewGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--success)" stopOpacity={0.4} />
            <stop offset="100%" stopColor="var(--success)" stopOpacity={0.02} />
          </linearGradient>
          {/* Auslauf ist ein Hinweis, keine Störung: Warnfarbe wie „Auslaufend (30T)“. */}
          <linearGradient id="aboExpiredGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--warning)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--warning)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="date"
          interval={tickInterval}
          tickFormatter={(value: string) => fmtMonth(value)}
          tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={CHART_TOOLTIP_STYLE}
          labelFormatter={(label) => (typeof label === "string" ? fmtDate(label) : "")}
          formatter={(value, name) => {
            const labels: Record<string, string> = {
              active: "Bestand",
              newCount: "Neu",
              expiredCount: "Auslauf",
            };
            return [String(value ?? 0), labels[String(name)] ?? String(name)];
          }}
        />
        <Area
          type="monotone"
          dataKey="active"
          stroke="var(--primary)"
          strokeWidth={2}
          fill="url(#aboActiveGradient)"
        />
        <Area
          type="monotone"
          dataKey="newCount"
          stroke="var(--success)"
          strokeWidth={1.5}
          fill="url(#aboNewGradient)"
        />
        <Area
          type="monotone"
          dataKey="expiredCount"
          stroke="var(--warning)"
          strokeWidth={1.5}
          fill="url(#aboExpiredGradient)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
