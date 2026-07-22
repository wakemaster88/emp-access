"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import Link from "next/link";

interface Go2rtcBannerProps {
  hasReolink: boolean;
}

const GRACE_MS = 20_000; // nach Mount/Reset: kein Banner während Warm-up
const FAILS_BEFORE_SHOW = 4; // ~1 Min bei 15-s-Intervall
const CHECK_INTERVAL_MS = 15_000;
const FETCH_TIMEOUT_MS = 8_000;

export function Go2rtcBanner({ hasReolink }: Go2rtcBannerProps) {
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    if (!hasReolink) {
      setShowBanner(false);
      return;
    }

    let cancelled = false;
    let failStreak = 0;
    let graceActive = true;
    const graceTimer = setTimeout(() => {
      graceActive = false;
    }, GRACE_MS);

    const check = async () => {
      const ctl = new AbortController();
      const timeout = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
      try {
        const r = await fetch("/api/go2rtc/status", {
          signal: ctl.signal,
          cache: "no-store",
        });
        clearTimeout(timeout);
        if (!r.ok) {
          failStreak += 1;
        } else {
          const data = (await r.json()) as { reachable?: boolean };
          if (data.reachable === true) {
            failStreak = 0;
            if (!cancelled) setShowBanner(false);
            return;
          }
          failStreak += 1;
        }
      } catch {
        clearTimeout(timeout);
        failStreak += 1;
      }

      if (!cancelled && !graceActive && failStreak >= FAILS_BEFORE_SHOW) {
        setShowBanner(true);
      }
    };

    // Beim Start nie sofort „down" anzeigen — erst nach Grace + mehreren Fehlschlägen.
    setShowBanner(false);
    failStreak = 0;
    check();
    const id = setInterval(check, CHECK_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
      clearTimeout(graceTimer);
    };
  }, [hasReolink]);

  if (!showBanner) return null;

  return (
    <div className="pointer-events-auto absolute left-1/2 top-3 z-50 flex max-w-2xl -translate-x-1/2 items-start gap-3 rounded-2xl bg-amber-500/15 px-4 py-3 text-sm text-amber-100 ring-1 ring-amber-500/40 shadow-lg backdrop-blur">
      <AlertTriangle className="mt-0.5 size-5 shrink-0" />
      <div className="flex-1">
        <div className="font-medium">Streams aus – go2rtc läuft nicht</div>
        <div className="mt-0.5 text-xs text-amber-100/80">
          Reolink-Cams brauchen go2rtc als Stream-Bridge. Im Terminal starten:
          <code className="mx-1 rounded bg-black/30 px-1.5 py-0.5 font-mono text-[11px]">
            ./scripts/start-go2rtc.sh
          </code>
          – oder dauerhaft per <Link href="/admin/settings" className="underline">Auto-Start</Link>.
        </div>
      </div>
    </div>
  );
}
