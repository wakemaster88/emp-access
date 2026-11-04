"use client";

/**
 * Klima übersteuern mit Ablauf (W17, Empfehlung 2): Plus/Minus am Soll, dann
 * „1 Std“, „2 Std“ oder „bis Betriebsende“. Die Änderung gilt bis zu diesem
 * Zeitpunkt, danach wieder der Plan. So bleibt kein vergessenes 24 °C stehen.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Minus, Plus, TimerReset } from "lucide-react";
import { fmtWhen } from "@/components/raeume/schedule-widget";
import type { RoomClimateView } from "@/components/raeume/types";
import { cn } from "@/lib/utils";

const MIN_C = 5;
const MAX_C = 30;
const STEP_C = 0.5;

const fmt1 = (v: number) => v.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function ClimateOverride({
  climate,
  openUntil,
  nowMs,
  timezone,
  readonly,
}: {
  climate: RoomClimateView;
  /** Ende des laufenden Betriebs- bzw. Schließblocks, falls bekannt. */
  openUntil: Date | null;
  nowMs: number;
  timezone: string;
  readonly: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const untilMs = climate.overrideUntil ? Date.parse(climate.overrideUntil) : null;
  const active = climate.overrideC != null && untilMs != null && untilMs > nowMs;
  const planC = climate.currentTargetC ?? climate.targetC;
  const shown = pending ?? planC;

  // Neue Serverdaten machen den Entwurf hinfällig.
  useEffect(() => setPending(null), [climate.overrideC, climate.overrideUntil, climate.currentTargetC]);

  async function send(init: RequestInit, url = "/api/klima/override") {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Fehlgeschlagen");
        return;
      }
      setPending(null);
      router.refresh();
    } catch {
      setError("Keine Verbindung");
    } finally {
      setBusy(false);
    }
  }

  const apply = (body: { minutes?: number; until?: string }) =>
    void send({ method: "POST", body: JSON.stringify({ roomId: climate.roomId, targetC: shown, ...body }) });
  const clear = () => void send({ method: "DELETE" }, `/api/klima/override?roomId=${climate.roomId}`);

  const now = new Date(nowMs);
  const blockUntil = openUntil && openUntil.getTime() > nowMs + 5 * 60_000 && openUntil.getTime() < nowMs + 24 * 3_600_000 ? openUntil : null;

  if (active) {
    return (
      <div className="mt-2 flex items-center gap-2 rounded-control bg-orange-500/10 px-3 py-2 text-[11px]">
        <TimerReset className="h-3.5 w-3.5 shrink-0 text-orange-600 dark:text-orange-400" />
        <span className="min-w-0 flex-1">
          <span className="font-semibold text-foreground">Übersteuert · {fmt1(climate.overrideC!)} °C</span>
          <span className="text-muted-foreground"> bis {fmtWhen(new Date(untilMs!), now, timezone)}, dann wieder Plan</span>
        </span>
        {!readonly && (
          <button
            type="button"
            onClick={clear}
            disabled={busy}
            className="h-7 shrink-0 rounded-full border border-border bg-background/60 px-2.5 text-[11px] font-medium disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Aufheben"}
          </button>
        )}
        {error && <span className="text-destructive">{error}</span>}
      </div>
    );
  }
  if (readonly) return null;

  const changed = pending != null && pending !== planC;
  const step = (dir: 1 | -1) => setPending(Math.min(MAX_C, Math.max(MIN_C, Math.round((shown + dir * STEP_C) * 2) / 2)));

  return (
    <div className="mt-2 rounded-control bg-foreground/5 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground">Soll jetzt</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => step(-1)}
            disabled={busy || shown <= MIN_C}
            aria-label="Soll senken"
            className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background/60 disabled:opacity-40"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span className={cn("w-16 text-center text-sm font-semibold tabular-nums", changed && "text-orange-600 dark:text-orange-400")}>{fmt1(shown)} °C</span>
          <button
            type="button"
            onClick={() => step(1)}
            disabled={busy || shown >= MAX_C}
            aria-label="Soll erhöhen"
            className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background/60 disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {changed && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="text-muted-foreground">gilt</span>
          {[
            { label: "1 Std", body: { minutes: 60 } },
            { label: "2 Std", body: { minutes: 120 } },
            ...(blockUntil ? [{ label: `bis ${fmtWhen(blockUntil, now, timezone)}`, body: { until: blockUntil.toISOString() } }] : []),
          ].map((c) => (
            <button
              key={c.label}
              type="button"
              onClick={() => apply(c.body)}
              disabled={busy}
              className="h-7 rounded-full bg-primary px-3 font-semibold text-primary-foreground disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : c.label}
            </button>
          ))}
          <button type="button" onClick={() => setPending(null)} disabled={busy} className="h-7 rounded-full px-2 text-muted-foreground hover:text-foreground">
            Verwerfen
          </button>
          {error && <span className="text-destructive">{error}</span>}
        </div>
      )}
    </div>
  );
}
