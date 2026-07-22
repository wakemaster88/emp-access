"use client";

import { useEffect, useState } from "react";
import { TileFrame } from "./tile-frame";
import { formatDate, formatTime } from "@/lib/utils";
import type { ClockWidget } from "@/lib/types";

interface ClockTileProps {
  widget: ClockWidget;
}

export function ClockTile({ widget }: ClockTileProps) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(
      () => setNow(new Date()),
      widget.showSeconds ? 1000 : 30_000,
    );
    return () => clearInterval(id);
  }, [widget.showSeconds]);

  return (
    <TileFrame title={widget.title} showTitleBar={widget.showTitleBar}>
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="font-mono text-[clamp(2rem,7vw,7rem)] font-light leading-none tracking-tight tabular-nums">
          {now ? formatTime(now, widget.showSeconds, widget.format === "12h") : "--:--"}
        </div>
        {widget.showDate && (
          <div className="text-[clamp(0.85rem,1.4vw,1.4rem)] text-white/70">
            {now ? formatDate(now) : ""}
          </div>
        )}
      </div>
    </TileFrame>
  );
}
