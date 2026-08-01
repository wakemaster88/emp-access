"use client";

import { useEffect, useRef, useState } from "react";
import { ScanLine, ShieldAlert, TriangleAlert } from "lucide-react";
import { TileFrame } from "./tile-frame";
import { cn } from "@/lib/utils";
import type { ScansWidget } from "@/lib/types";

interface ScanRow {
  id: number;
  ts: number;
  code: string;
  result: "GRANTED" | "DENIED" | "PROTECTED";
  device: string;
  deviceId: number | null;
  ticket: string | null;
  ticketType: string | null;
}

interface ScansResponse {
  configured: boolean;
  scans: ScanRow[];
  error: string | null;
  fetchedAt: number;
}

interface ScansTileProps {
  widget: ScansWidget;
}

/** Wie lange ein frisch eingetroffener Scan hervorgehoben bleibt. */
const FLASH_MS = 4000;

const RESULT_STYLE: Record<ScanRow["result"], string> = {
  GRANTED: "border-emerald-500/35 bg-emerald-500/10 text-emerald-200",
  DENIED: "border-rose-500/40 bg-rose-500/10 text-rose-200",
  PROTECTED: "border-amber-500/40 bg-amber-500/10 text-amber-200",
};

const RESULT_LABEL: Record<ScanRow["result"], string> = {
  GRANTED: "Frei",
  DENIED: "Abgelehnt",
  PROTECTED: "Gesperrt",
};

function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function ScansTile({ widget }: ScansTileProps) {
  const [data, setData] = useState<ScansResponse | null>(null);
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const seen = useRef<Set<number> | null>(null);

  useEffect(() => {
    let alive = true;
    const timers: ReturnType<typeof setTimeout>[] = [];

    async function poll() {
      try {
        const r = await fetch(`/api/emp-access/scans?limit=${widget.limit}`, {
          cache: "no-store",
        });
        if (!r.ok || !alive) return;
        const next = (await r.json()) as ScansResponse;
        if (!alive) return;
        setData(next);

        const ids = next.scans.map((s) => s.id);
        // Beim ersten Laden nichts aufblinken lassen — sonst leuchtet die
        // ganze Kachel auf, sobald jemand das Dashboard öffnet.
        if (seen.current === null) {
          seen.current = new Set(ids);
          return;
        }
        const arrived = ids.filter((id) => !seen.current!.has(id));
        if (arrived.length === 0) return;
        for (const id of arrived) seen.current.add(id);
        setFresh((f) => new Set([...f, ...arrived]));
        timers.push(
          setTimeout(() => {
            if (!alive) return;
            setFresh((f) => {
              const n = new Set(f);
              for (const id of arrived) n.delete(id);
              return n;
            });
          }, FLASH_MS),
        );
      } catch {
        // Nächster Tick versucht es erneut.
      }
    }

    void poll();
    const id = setInterval(poll, widget.intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
      for (const t of timers) clearTimeout(t);
    };
  }, [widget.limit, widget.intervalMs]);

  const rows = (data?.scans ?? [])
    .filter((s) => widget.deviceIds.length === 0 || (s.deviceId !== null && widget.deviceIds.includes(s.deviceId)))
    .filter((s) => !widget.deniedOnly || s.result !== "GRANTED")
    .slice(0, widget.limit);

  const stale = !!data?.error;

  const body = () => {
    if (!data) {
      return <Hint>Lade Scans…</Hint>;
    }
    if (!data.configured) {
      return (
        <Hint icon={<ShieldAlert className="size-4" />}>
          emp-access ist nicht verbunden. Unter Admin → Einstellungen aktivieren.
        </Hint>
      );
    }
    if (rows.length === 0) {
      return (
        <Hint>{widget.deniedOnly ? "Keine abgelehnten Scans" : "Noch keine Scans"}</Hint>
      );
    }
    return (
      <ul className="flex h-full flex-col gap-1 overflow-y-auto p-2">
        {rows.map((s) => (
          <li
            key={s.id}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-2 py-1.5 transition-colors duration-700",
              RESULT_STYLE[s.result],
              fresh.has(s.id) && "ring-2 ring-white/40",
            )}
          >
            <span className="shrink-0 font-mono text-[clamp(0.7rem,0.85vw,0.95rem)] tabular-nums opacity-80">
              {clock(s.ts)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[clamp(0.75rem,0.95vw,1.05rem)] font-medium">
                {s.ticket ?? s.code}
              </p>
              <p className="truncate text-[clamp(0.65rem,0.8vw,0.9rem)] opacity-70">
                {s.device}
                {s.ticketType ? ` · ${s.ticketType}` : ""}
              </p>
            </div>
            {/* Grün sagt schon „durchgelassen" — Text nur da, wo es klemmt. */}
            {s.result !== "GRANTED" && (
              <span className="shrink-0 rounded px-1.5 py-0.5 text-[clamp(0.6rem,0.75vw,0.85rem)] font-semibold uppercase tracking-wide opacity-90">
                {RESULT_LABEL[s.result]}
              </span>
            )}
          </li>
        ))}
      </ul>
    );
  };

  return (
    <TileFrame
      title={widget.title}
      showTitleBar={widget.showTitleBar}
      badge={
        <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-foreground/45">
          {stale ? (
            <>
              <TriangleAlert className="size-3 text-amber-400" />
              Verbindung gestört
            </>
          ) : (
            <>
              <ScanLine className="size-3" />
              Live
            </>
          )}
        </span>
      }
    >
      {body()}
    </TileFrame>
  );
}

function Hint({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center gap-2 px-4 text-center text-sm text-foreground/55">
      {icon}
      <span>{children}</span>
    </div>
  );
}
