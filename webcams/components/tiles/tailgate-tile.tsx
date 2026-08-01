"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, ShieldAlert, TriangleAlert } from "lucide-react";
import { TileFrame } from "./tile-frame";
import { cn } from "@/lib/utils";
import type { TailgateWidget } from "@/lib/types";

interface StatusRow {
  camId: string;
  camName: string;
  checkedAt: number;
  crossings: number;
  scans: number;
  diff: number;
  tolerance: number;
  windowSec: number;
  lastError: string | null;
  lastAlarmAt: number;
}

interface AlarmRow {
  id: string;
  ts: number;
  camName: string;
  crossings: number;
  scans: number;
  diff: number;
  windowSec: number;
}

interface TailgateResponse {
  configured: boolean;
  status: StatusRow[];
  alarms: AlarmRow[];
}

interface TailgateTileProps {
  widget: TailgateWidget;
}

function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function minutes(sec: number): string {
  const m = Math.round(sec / 60);
  return m >= 1 ? `${m} min` : `${sec} s`;
}

export function TailgateTile({ widget }: TailgateTileProps) {
  const [data, setData] = useState<TailgateResponse | null>(null);

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const r = await fetch("/api/tailgate", { cache: "no-store" });
        if (!r.ok || !alive) return;
        const next = (await r.json()) as TailgateResponse;
        if (alive) setData(next);
      } catch {
        // Nächster Tick versucht es erneut.
      }
    }
    void poll();
    const id = setInterval(poll, widget.intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [widget.intervalMs]);

  const status = widget.camId
    ? data?.status.find((s) => s.camId === widget.camId)
    : data?.status[0];
  const alarms = (data?.alarms ?? []).filter(
    (a) => !widget.camId || a.camName === status?.camName,
  );

  // Über der Toleranz ist es ein Alarm, knapp darunter ein Hinweis.
  const level = !status
    ? "unknown"
    : status.lastError
      ? "error"
      : status.diff >= status.tolerance
        ? "alarm"
        : status.diff > 0
          ? "warn"
          : "ok";

  const body = () => {
    if (!data) return <Hint>Lade…</Hint>;
    if (!data.configured) {
      return (
        <Hint icon={<ShieldAlert className="size-4" />}>
          Noch keine Kamera mit Drehkreuz-Kontrolle. Unter Admin → Kameras
          einschalten.
        </Hint>
      );
    }
    if (!status) return <Hint>Warte auf erste Auswertung…</Hint>;
    if (status.lastError) {
      return (
        <Hint icon={<TriangleAlert className="size-4 text-amber-400" />}>
          {status.lastError}
        </Hint>
      );
    }

    return (
      <div className="flex h-full flex-col gap-2 p-2">
        <div
          className={cn(
            "grid grid-cols-3 gap-2 rounded-lg border p-2 text-center",
            level === "alarm"
              ? "border-rose-500/40 bg-rose-500/10"
              : level === "warn"
                ? "border-amber-500/40 bg-amber-500/10"
                : "border-emerald-500/35 bg-emerald-500/10",
          )}
        >
          <Stat label="Durchgänge" value={status.crossings} />
          <Stat label="Scans" value={status.scans} />
          <Stat
            label="ungedeckt"
            value={Math.max(0, status.diff)}
            strong={level === "alarm"}
          />
        </div>

        <p className="text-center text-[clamp(0.6rem,0.75vw,0.8rem)] text-foreground/45">
          letzte {minutes(status.windowSec)} · Alarm ab {status.tolerance}
        </p>

        {alarms.length > 0 && (
          <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
            {alarms.slice(0, 6).map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-rose-200"
              >
                <span className="shrink-0 font-mono text-[clamp(0.65rem,0.8vw,0.85rem)] tabular-nums opacity-80">
                  {clock(a.ts)}
                </span>
                <span className="truncate text-[clamp(0.7rem,0.85vw,0.95rem)]">
                  {a.diff} ohne Scan ({a.crossings} zu {a.scans})
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  return (
    <TileFrame
      title={widget.title}
      showTitleBar={widget.showTitleBar}
      badge={
        <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-foreground/45">
          {level === "alarm" ? (
            <>
              <ShieldAlert className="size-3 text-rose-400" />
              Alarm
            </>
          ) : level === "error" ? (
            <>
              <TriangleAlert className="size-3 text-amber-400" />
              Störung
            </>
          ) : (
            <>
              <ShieldCheck className="size-3" />
              {status?.camName ?? "Kontrolle"}
            </>
          )}
        </span>
      }
    >
      {body()}
    </TileFrame>
  );
}

function Stat({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: number;
  strong?: boolean;
}) {
  return (
    <div>
      <p
        className={cn(
          "font-semibold tabular-nums text-[clamp(1.1rem,2.2vw,2rem)]",
          strong && "text-rose-200",
        )}
      >
        {value}
      </p>
      <p className="text-[clamp(0.55rem,0.7vw,0.75rem)] uppercase tracking-wide opacity-60">
        {label}
      </p>
    </div>
  );
}

function Hint({
  icon,
  children,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full items-center justify-center gap-2 px-4 text-center text-sm text-foreground/55">
      {icon}
      <span>{children}</span>
    </div>
  );
}
