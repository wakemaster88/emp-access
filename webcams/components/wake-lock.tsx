"use client";

import { useEffect } from "react";

/**
 * Hält den Bildschirm wach, wenn das Dashboard sichtbar ist.
 * Browser-Wake-Lock-API; auf Safari verfügbar ab macOS 14.
 */
export function WakeLock() {
  useEffect(() => {
    const nav = navigator as Navigator & {
      wakeLock?: {
        request: (type: "screen") => Promise<{
          release: () => Promise<void>;
          addEventListener: (ev: string, cb: () => void) => void;
        }>;
      };
    };
    if (!nav.wakeLock) return;

    let lock: Awaited<ReturnType<NonNullable<typeof nav.wakeLock>["request"]>> | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        if (cancelled) return;
        lock = await nav.wakeLock!.request("screen");
        lock.addEventListener("release", () => {
          // Re-acquire if the page is visible again
          if (!cancelled && document.visibilityState === "visible") {
            setTimeout(acquire, 1000);
          }
        });
      } catch {
        /* user navigated, browser denied, etc. */
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") acquire();
    };

    acquire();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      lock?.release().catch(() => {});
    };
  }, []);

  return null;
}
