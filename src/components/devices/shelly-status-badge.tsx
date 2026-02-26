"use client";

import { useEffect, useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Wifi, WifiOff, Power, PowerOff, Zap, Loader2, RefreshCw } from "lucide-react";

interface ShellyStatus {
  online: boolean;
  output: boolean | null;
  power?: number;
  source: "local" | "cloud" | "unavailable";
}

interface ShellyStatusBadgeProps {
  deviceId: number;
  category?: string | null;
}

export function ShellyStatusBadge({ deviceId, category }: ShellyStatusBadgeProps) {
  const [status, setStatus] = useState<ShellyStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const isLight = category === "BELEUCHTUNG";
  const isSwitch = category === "SCHALTER";

  const fetch_status = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/devices/${deviceId}/shelly-status`);
      if (res.ok) setStatus(await res.json());
    } finally {
      setLoading(false);
    }
  }, [deviceId]);

  useEffect(() => {
    fetch_status();
    // Auto-refresh every 30 s
    const interval = setInterval(fetch_status, 30_000);
    return () => clearInterval(interval);
  }, [fetch_status]);

  if (loading && !status) {
    return (
      <Badge variant="secondary" className="gap-1.5 animate-pulse">
        <Loader2 className="h-3 w-3 animate-spin" />
        Lädt…
      </Badge>
    );
  }

  if (!status) return null;

  const onLabel  = isLight ? "Eingeschaltet" : isSwitch ? "Ein" : "Aktiv";
  const offLabel = isLight ? "Ausgeschaltet" : isSwitch ? "Aus" : "Inaktiv";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Online / Offline */}
      {status.online ? (
        <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 gap-1.5">
          <Wifi className="h-3 w-3" /> Online
          {status.source === "local" && <span className="text-emerald-500/70 text-[10px]">(lokal)</span>}
          {status.source === "cloud" && <span className="text-emerald-500/70 text-[10px]">(cloud)</span>}
        </Badge>
      ) : (
        <Badge variant="secondary" className="gap-1.5 text-slate-400">
          <WifiOff className="h-3 w-3" /> Offline
        </Badge>
      )}

      {/* Ein / Aus */}
      {status.output === true && (
        <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 gap-1.5">
          <Power className="h-3 w-3" /> {onLabel}
        </Badge>
      )}
      {status.output === false && (
        <Badge variant="secondary" className="gap-1.5 text-slate-400">
          <PowerOff className="h-3 w-3" /> {offLabel}
        </Badge>
      )}

      {/* Leistung */}
      {status.power !== undefined && status.power > 0 && (
        <Badge variant="outline" className="gap-1 text-xs text-slate-500 dark:text-slate-400">
          <Zap className="h-3 w-3 text-amber-500" />
          {status.power.toFixed(1)} W
        </Badge>
      )}

      {/* Refresh */}
      <Button
        variant="ghost"
        size="sm"
        onClick={fetch_status}
        disabled={loading}
        className="h-6 w-6 p-0 text-slate-400 hover:text-slate-600"
        title="Status aktualisieren"
      >
        <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
      </Button>
    </div>
  );
}
