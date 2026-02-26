"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";

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
      <Badge variant="secondary" className="text-slate-300 gap-1 animate-pulse text-xs">
        <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
        …
      </Badge>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      {online ? (
        <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 gap-1 text-xs">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Online
        </Badge>
      ) : (
        <Badge variant="secondary" className="text-slate-400 gap-1 text-xs">
          <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
          Offline
        </Badge>
      )}
      {online && output !== null && (
        <span className={`text-xs font-medium ${output ? "text-amber-600 dark:text-amber-400" : "text-slate-400"}`}>
          {output ? "Ein" : "Aus"}
        </span>
      )}
    </div>
  );
}
