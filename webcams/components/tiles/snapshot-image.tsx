"use client";

import { useEffect, useRef, useState } from "react";

interface SnapshotImageProps {
  url: string;
  intervalMs?: number;
  className?: string;
  /** "contain" für Panorama-Cams (Duo 3), sonst wird das Bild gecroppt. */
  fit?: "cover" | "contain";
  onError?: (e: Error) => void;
}

/**
 * Zeigt ein Bild und lädt es in festem Intervall neu.
 * Lädt das Bild als Blob, um Memory-Leaks und Caching-Probleme zu vermeiden.
 */
export function SnapshotImage({
  url,
  intervalMs = 2000,
  className,
  fit = "cover",
  onError,
}: SnapshotImageProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [status, setStatus] = useState<"loading" | "live" | "error">("loading");
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastObjectUrl: string | null = null;

    const tick = async () => {
      try {
        const sep = url.includes("?") ? "&" : "?";
        const r = await fetch(`${url}${sep}_t=${Date.now()}`, { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const blob = await r.blob();
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(blob);
        if (imgRef.current) imgRef.current.src = objectUrl;
        if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
        lastObjectUrl = objectUrl;
        setStatus("live");
        setErrMsg(null);
      } catch (err) {
        if (cancelled) return;
        const e = err as Error;
        setStatus("error");
        setErrMsg(e.message);
        onErrorRef.current?.(e);
      } finally {
        if (!cancelled) timer = setTimeout(tick, intervalMs);
      }
    };

    tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
    };
  }, [url, intervalMs]);

  return (
    <div className={`relative h-full w-full ${className ?? ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        alt=""
        className={`h-full w-full ${fit === "contain" ? "object-contain" : "object-cover"}`}
      />
      {status !== "live" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/60 text-sm text-white/80">
          {status === "loading" && "Lade…"}
          {status === "error" && (
            <div className="text-center">
              <div className="text-red-400">Snapshot offline</div>
              {errMsg && <div className="text-xs text-white/50">{errMsg}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
