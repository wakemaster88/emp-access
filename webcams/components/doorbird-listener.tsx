"use client";

import { useEffect, useState } from "react";
import { DoorbirdOverlay } from "./doorbird-overlay";
import { subscribeRing } from "./use-doorbird-events";
import type { DoorbirdConfig } from "@/lib/types";

interface DoorbirdListenerProps {
  doorbird: DoorbirdConfig;
  go2rtcUrl: string;
}

export function DoorbirdListener({ doorbird, go2rtcUrl }: DoorbirdListenerProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!doorbird.enabled) return;
    return subscribeRing(() => setOpen(true));
  }, [doorbird.enabled]);

  if (!doorbird.enabled || !open) return null;
  return (
    <DoorbirdOverlay
      go2rtcUrl={go2rtcUrl}
      ringSoundUrl={doorbird.ringSoundUrl}
      autoHideSec={doorbird.autoHideSec}
      onClose={() => setOpen(false)}
    />
  );
}
