"use client";

import { useEffect, useState } from "react";
import { Activity, TriangleAlert } from "lucide-react";
import { TileFrame } from "./tile-frame";
import { cn } from "@/lib/utils";
import type { ServicesWidget } from "@/lib/types";

interface ServiceRow {
  id: string;
  name: string;
  ok: boolean;
  detail?: string;
  error?: string;
  ms: number;
}

interface ServiceStatusPayload {
  checkedAt: number;
  services: ServiceRow[];
}

interface ServicesTileProps {
  widget: ServicesWidget;
}

function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function ServicesTile({ widget }: ServicesTileProps) {
  const [data, setData] = useState<ServiceStatusPayload | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const r = await fetch("/api/services/status", { cache: "no-store" });
        if (!alive) return;
        if (!r.ok) {
          setFetchError(`HTTP ${r.status}`);
          return;
        }
        const next = (await r.json()) as ServiceStatusPayload;
        if (!alive) return;
        setData(next);
        setFetchError(null);
      } catch {
        if (alive) setFetchError("keine Antwort");
      }
    }
    void poll();
    const id = setInterval(poll, widget.intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [widget.intervalMs]);

  const services = data?.services ?? [];
  const down = services.filter((s) => !s.ok);
  const level = fetchError ? "error" : down.length > 0 ? "down" : data ? "ok" : "unknown";

  return (
    <TileFrame
      title={widget.title}
      showTitleBar={widget.showTitleBar}
      badge={
        <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-foreground/45">
          {level === "ok" ? (
            <>
              <Activity className="size-3 text-emerald-400" />
              alle ok
            </>
          ) : level === "down" ? (
            <>
              <TriangleAlert className="size-3 text-rose-400" />
              {down.length === 1 ? "1 Störung" : `${down.length} Störungen`}
            </>
          ) : level === "error" ? (
            <>
              <TriangleAlert className="size-3 text-amber-400" />
              keine Daten
            </>
          ) : (
            "prüfe…"
          )}
        </span>
      }
    >
      <div className="flex h-full min-h-0 flex-col gap-1 p-2">
        {fetchError && !data ? (
          <p className="px-1 text-[clamp(0.7rem,0.9vw,0.95rem)] text-amber-200/90">
            Status nicht erreichbar ({fetchError})
          </p>
        ) : null}
        <ul className="flex min-h-0 flex-1 flex-col justify-evenly gap-0.5 overflow-y-auto">
          {services.map((s) => (
            <ServiceLine key={s.id} row={s} />
          ))}
        </ul>
        {data ? (
          <p className="shrink-0 px-1 text-right text-[clamp(0.5rem,0.65vw,0.7rem)] tabular-nums text-foreground/35">
            {clock(data.checkedAt)}
          </p>
        ) : null}
      </div>
    </TileFrame>
  );
}

function ServiceLine({ row }: { row: ServiceRow }) {
  return (
    <li className="flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-0.5">
      <span
        className={cn(
          "size-2 shrink-0 rounded-full",
          row.ok ? "bg-emerald-400 shadow-[0_0_6px] shadow-emerald-400/70" : "bg-rose-400 shadow-[0_0_6px] shadow-rose-400/70",
        )}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate text-[clamp(0.7rem,0.95vw,1rem)] font-medium text-foreground/90">
        {row.name}
      </span>
      <span
        className={cn(
          "max-w-[55%] truncate text-right text-[clamp(0.6rem,0.75vw,0.8rem)] tabular-nums",
          row.ok ? "text-foreground/45" : "text-rose-200/90",
        )}
        title={row.ok ? row.detail : row.error}
      >
        {row.ok ? row.detail : row.error}
      </span>
    </li>
  );
}
