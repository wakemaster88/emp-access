"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { StatusDot } from "@/components/ui/status-dot";

interface Props {
  deviceId: number;
}

export function ShellyOnlineDot({ deviceId }: Props) {
  const [online, setOnline] = useState<boolean | null>(null);
  const [output, setOutput] = useState<boolean | null>(null);

  useEffect(() => {
    fetch(`/api/devices/${deviceId}/shelly-status`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (d) {
          setOnline(d.online);
          setOutput(d.output);
        }
      })
      .catch(() => {});
  }, [deviceId]);

  if (online === null) {
    return (
      <Badge variant="neutral" className="gap-1 text-xs">
        <Loader2 className="h-3 w-3 animate-spin" />
        Lädt …
      </Badge>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      {online ? (
        <Badge variant="success" className="gap-1 text-xs">
          <StatusDot tone="success" size="xs" />
          Online
        </Badge>
      ) : (
        <Badge variant="danger" className="gap-1 text-xs">
          <StatusDot tone="danger" size="xs" />
          Offline
        </Badge>
      )}
      {online && output !== null && (
        <span className={`text-xs font-medium ${output ? "text-success" : "text-muted-foreground"}`}>
          {output ? "Ein" : "Aus"}
        </span>
      )}
    </div>
  );
}
