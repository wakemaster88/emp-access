"use client";

import { useEffect, useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Wifi, WifiOff, Power, PowerOff, Zap, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

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
      <Badge variant="neutral" className="gap-1.5">
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
        <Badge variant="success" className="gap-1.5">
          <Wifi className="h-3 w-3" /> Online
          {status.source === "local" && <span className="text-[10px] font-medium opacity-80">(lokal)</span>}
          {status.source === "cloud" && <span className="text-[10px] font-medium opacity-80">(cloud)</span>}
        </Badge>
      ) : (
        <Badge variant="danger" className="gap-1.5">
          <WifiOff className="h-3 w-3" /> Offline
        </Badge>
      )}

      {/* Ein / Aus */}
      {/* Zustandsfarbe: Licht an = amber, sonst eingeschaltet = grün. */}
      {status.output === true && (
        <Badge
          variant={isLight ? "neutral" : "success"}
          className={cn("gap-1.5", isLight && "bg-amber-500/15 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300")}
        >
          <Power className="h-3 w-3" /> {onLabel}
        </Badge>
      )}
      {status.output === false && (
        <Badge variant="neutral" className="gap-1.5">
          <PowerOff className="h-3 w-3" /> {offLabel}
        </Badge>
      )}

      {/* Leistung */}
      {status.power !== undefined && status.power > 0 && (
        <Badge variant="outline" className="gap-1 text-xs text-muted-foreground tabular-nums">
          <Zap className="h-3 w-3" />
          {status.power.toFixed(1)} W
        </Badge>
      )}

      {/* Refresh */}
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={fetch_status}
        disabled={loading}
        className="text-muted-foreground hover:text-foreground"
        title="Status aktualisieren"
        aria-label="Status aktualisieren"
      >
        <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
      </Button>
    </div>
  );
}
