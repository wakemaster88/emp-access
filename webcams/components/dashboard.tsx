"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Tile } from "./tiles";
import { CamControlPanel } from "./cam-control-panel";
import { DoorbirdListener } from "./doorbird-listener";
import { TailgateAlertListener } from "./tailgate-alert-listener";
import { WakeLock } from "./wake-lock";
import { resolveLayout, findActiveLayout, type ResolvedLayout } from "@/lib/layout";
import type { Config } from "@/lib/types";
import { Settings as SettingsIcon, X } from "lucide-react";
import Link from "next/link";
import { ToastProvider } from "./ui/toast";

interface DashboardProps {
  initialConfig: Config;
}

export function Dashboard(props: DashboardProps) {
  return (
    <ToastProvider>
      <DashboardInner {...props} />
    </ToastProvider>
  );
}

function DashboardInner({ initialConfig }: DashboardProps) {
  const [config, setConfig] = useState<Config>(initialConfig);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [showChrome, setShowChrome] = useState(true);
  /**
   * Wird hochgezählt um allen Streams einen sauberen Reconnect zu signalisieren.
   * Ausgelöst von:
   *   - Sichtbarkeitswechsel (Tab kommt zurück / Wake-up nach Sleep)
   *   - Periodisch nach `streamRefreshMin`
   *   - Manueller Reload-Button (über Modal/ControlPanel — eigenes State)
   */
  const [streamReloadKey, setStreamReloadKey] = useState(0);

  // Re-fetch config periodically so changes from /admin propagate.
  // Diff-Check: identischer Inhalt behält die alte Objekt-Referenz, damit
  // nicht alle 5 s der komplette Tile-Baum re-rendert.
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const r = await fetch("/api/config", { cache: "no-store" });
        if (r.ok) {
          const data = (await r.json()) as Config;
          setConfig((prev) =>
            JSON.stringify(prev) === JSON.stringify(data) ? prev : data,
          );
        }
      } catch {}
    }, 5000);
    return () => clearInterval(id);
  }, []);

  // Optional: voller Page-Reload alle N Minuten (Memory-Leak-Vermeidung)
  useEffect(() => {
    const min = config.settings.reloadIntervalMin;
    if (!min || min <= 0) return;
    const id = setTimeout(() => window.location.reload(), min * 60 * 1000);
    return () => clearTimeout(id);
  }, [config.settings.reloadIntervalMin]);

  // Periodischer Stream-Refresh: alle Streams neu verbinden, ohne die Seite
  // neuzuladen. Verhindert die seltenen „immer noch live, aber kein Frame mehr"-
  // Fälle, die der Stall-Watchdog (8 s) zur Not auch fängt — der periodische
  // Reset ist eher Gürtel + Hosenträger.
  useEffect(() => {
    const min = config.settings.streamRefreshMin;
    if (!min || min <= 0) return;
    const id = setInterval(() => {
      setStreamReloadKey((k) => k + 1);
    }, min * 60 * 1000);
    return () => clearInterval(id);
  }, [config.settings.streamRefreshMin]);

  // Wenn der Tab/das Fenster wieder sichtbar wird: einmal alle Streams
  // anstoßen. macOS/iOS pausiert WebRTC im Hintergrund teils komplett — ohne
  // Anstoß kommt nichts mehr zurück.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") {
        setStreamReloadKey((k) => k + 1);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
    };
  }, []);

  // Beim Wechsel von go2rtc-URL alle Streams zwingen neu zu verbinden.
  useEffect(() => {
    setStreamReloadKey((k) => k + 1);
  }, [config.settings.go2rtcUrl]);

  // Auto-hide chrome (top bar) after 3 s of no mouse movement
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const reset = () => {
      setShowChrome(true);
      clearTimeout(timeout);
      timeout = setTimeout(() => setShowChrome(false), 3000);
    };
    reset();
    window.addEventListener("mousemove", reset);
    window.addEventListener("keydown", reset);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener("mousemove", reset);
      window.removeEventListener("keydown", reset);
    };
  }, []);

  // Global shortcuts: 1-9, 0 = cam slot · F = fullscreen
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        if (document.fullscreenElement) {
          document.exitFullscreen();
        } else {
          document.documentElement.requestFullscreen().catch(() => {});
        }
        return;
      }
      if (/^[0-9]$/.test(e.key)) {
        const idx = e.key === "0" ? 9 : Number(e.key) - 1;
        // Find Nth reolink widget
        const reolinkWidgets = config.widgets.filter(
          (w) => w.enabled && w.type === "reolink",
        );
        const target = reolinkWidgets[idx];
        if (target) {
          e.preventDefault();
          setFocusId(target.id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [config.widgets]);

  // Auto-Rotate: zyklisch (oder zufällig) durch alle benannten Layouts.
  const autoRotate = config.settings.autoRotate;
  const layoutCount = config.layouts.length;
  const [rotateIdx, setRotateIdx] = useState(0);
  useEffect(() => {
    if (!autoRotate.enabled || layoutCount < 2) return;
    const id = setInterval(() => {
      setRotateIdx((i) =>
        autoRotate.order === "random"
          ? Math.floor(Math.random() * layoutCount)
          : (i + 1) % layoutCount,
      );
    }, autoRotate.intervalSec * 1000);
    return () => clearInterval(id);
  }, [autoRotate.enabled, autoRotate.intervalSec, autoRotate.order, layoutCount]);

  const layout: ResolvedLayout = useMemo(() => {
    const active =
      autoRotate.enabled && layoutCount > 1
        ? config.layouts[rotateIdx % layoutCount]
        : findActiveLayout(config);
    return resolveLayout(config, active);
  }, [config, autoRotate.enabled, layoutCount, rotateIdx]);

  const handleFocus = useCallback((id: string) => setFocusId(id), []);

  const focusedTile = focusId ? layout.tiles.find((t) => t.widget.id === focusId) : null;

  const go2rtcUrl = config.settings.go2rtcUrl || "http://127.0.0.1:1984";

  return (
    <div className="relative h-full w-full">
      {/* Top bar (auto-hide) */}
      <div
        className={`pointer-events-none fixed inset-x-0 top-0 z-40 flex justify-end p-3 transition-opacity duration-500 ${
          showChrome ? "opacity-100" : "opacity-0"
        }`}
      >
        <Link
          href="/admin"
          className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-tile-accent px-4 py-2 text-sm text-foreground/80 ring-1 ring-border hover:text-foreground"
        >
          <SettingsIcon className="size-4" />
          Admin
        </Link>
      </div>

      {/* Dashboard grid läuft IMMER — wenn eine Kamera „fokussiert" wird,
          legen wir ein Modal darüber, statt das Grid auszutauschen. So
          bleiben alle Streams im Hintergrund live. */}
      <GridView
        layout={layout}
        cams={config.cams}
        doorbird={config.doorbird}
        go2rtcUrl={go2rtcUrl}
        onFocus={handleFocus}
        reloadKey={streamReloadKey}
        suspendedId={focusId}
      />

      {focusedTile && (
        <CamModal
          focusedTile={focusedTile}
          cams={config.cams}
          doorbird={config.doorbird}
          go2rtcUrl={go2rtcUrl}
          baseReloadKey={streamReloadKey}
          onClose={() => setFocusId(null)}
        />
      )}

      {/* Empty state */}
      {layout.tiles.length === 0 && <EmptyState />}

      {/* Doorbird ring overlay */}
      <DoorbirdListener doorbird={config.doorbird} go2rtcUrl={go2rtcUrl} />

      {/* Ton und Hinweis bei einem Durchgang ohne gültigen Scan */}
      <TailgateAlertListener />

      {/* Halte den Bildschirm wach */}
      <WakeLock />
    </div>
  );
}

/**
 * Memoisiert: re-rendert nur bei echten Prop-Änderungen — nicht bei
 * UI-State des Dashboards (Chrome ein-/ausblenden etc.).
 */
const GridView = memo(function GridView({
  layout,
  cams,
  doorbird,
  go2rtcUrl,
  onFocus,
  reloadKey,
  suspendedId,
}: {
  layout: ResolvedLayout;
  cams: Config["cams"];
  doorbird: Config["doorbird"];
  go2rtcUrl: string;
  onFocus: (id: string) => void;
  reloadKey: number;
  /** Widget, das gerade im Fokus-Modal läuft — Grid-Stream pausieren. */
  suspendedId: string | null;
}) {
  return (
    <div
      className="grid h-full w-full gap-2 p-2"
      style={{
        gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))`,
      }}
    >
      {layout.tiles.map((t) => (
        <div
          key={t.widget.id}
          style={{
            gridColumn: `${t.x + 1} / span ${t.w}`,
            gridRow: `${t.y + 1} / span ${t.h}`,
          }}
          className="min-h-0 min-w-0"
        >
          <GridTile
            widget={t.widget}
            cams={cams}
            doorbird={doorbird}
            go2rtcUrl={go2rtcUrl}
            onFocusId={onFocus}
            reloadKey={reloadKey}
            suspended={suspendedId === t.widget.id}
          />
        </div>
      ))}
    </div>
  );
});

/**
 * Pro-Kachel-Memo mit stabilen Props (Callback nimmt die Widget-ID statt
 * einer pro-Render neu erzeugten Closure). Während das Fokus-Modal dieselbe
 * Cam im Main-Stream zeigt, wird der Grid-Stream pausiert — sonst laufen
 * zwei WebRTC-Decodes derselben Kamera parallel.
 */
const GridTile = memo(function GridTile({
  widget,
  cams,
  doorbird,
  go2rtcUrl,
  onFocusId,
  reloadKey,
  suspended,
}: {
  widget: Config["widgets"][number];
  cams: Config["cams"];
  doorbird: Config["doorbird"];
  go2rtcUrl: string;
  onFocusId: (id: string) => void;
  reloadKey: number;
  suspended: boolean;
}) {
  const onFocus = useCallback(() => onFocusId(widget.id), [onFocusId, widget.id]);
  if (suspended) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-xl bg-black/40 ring-1 ring-border">
        <span className="text-xs text-foreground/40">läuft im Fokus-Modus</span>
      </div>
    );
  }
  return (
    <Tile
      widget={widget}
      cams={cams}
      doorbird={doorbird}
      go2rtcUrl={go2rtcUrl}
      onFocus={onFocus}
      reloadKey={reloadKey}
    />
  );
});

function CamModal({
  focusedTile,
  cams,
  doorbird,
  go2rtcUrl,
  baseReloadKey,
  onClose,
}: {
  focusedTile: ResolvedLayout["tiles"][number];
  cams: Config["cams"];
  doorbird: Config["doorbird"];
  go2rtcUrl: string;
  baseReloadKey: number;
  onClose: () => void;
}) {
  const [localBump, setLocalBump] = useState(0);
  // Modal-Tile reagiert sowohl auf den globalen Refresh (Tab-Wake, periodisch)
  // als auch auf den manuellen Reload aus dem Control-Panel.
  const reloadKey = baseReloadKey * 10_000 + localBump;
  const widget = focusedTile.widget;
  const focusedCam =
    widget.type === "reolink"
      ? cams.find((c) => c.id === widget.camId)
      : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // Body-Scroll während Modal sperren — Dashboard im Hintergrund bewegt sich
    // ohnehin nicht, aber falls die Seite mal gescrollt ist, sieht's hässlich
    // aus, wenn der Backdrop nicht den ganzen sichtbaren Bereich abdeckt.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex bg-black/75 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`relative m-auto flex h-[calc(100%-1rem)] w-[calc(100%-1rem)] max-w-[1600px] flex-col gap-3 p-2 md:h-[calc(100%-3rem)] md:w-[calc(100%-3rem)] md:p-4 ${
          focusedCam ? "md:grid md:grid-cols-[1fr_320px] md:gap-4" : ""
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-2xl bg-black/40 ring-1 ring-white/10">
          <Tile
            widget={widget}
            cams={cams}
            doorbird={doorbird}
            go2rtcUrl={go2rtcUrl}
            focused
            reloadKey={reloadKey}
          />
        </div>
        {focusedCam && (
          <div className="max-h-full min-h-0 overflow-y-auto pr-1">
            <CamControlPanel
              cam={focusedCam}
              onReloadStream={() => setLocalBump((k) => k + 1)}
            />
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          aria-label="Schließen (Esc)"
          className="absolute -right-1 -top-1 z-10 inline-flex size-9 items-center justify-center rounded-full bg-tile-accent text-foreground/80 shadow-lg ring-1 ring-border hover:text-foreground md:right-2 md:top-2"
        >
          <X className="size-5" />
        </button>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-3xl font-light tracking-tight">Webcams Dashboard</h1>
      <p className="max-w-xl text-foreground/60">
        Noch keine Widgets konfiguriert. Lege Cams und Kacheln im Admin-Bereich
        an.
      </p>
      <Link
        href="/admin"
        className="rounded-full bg-focus px-6 py-3 text-sm font-medium text-black hover:brightness-110"
      >
        Zum Admin
      </Link>
    </div>
  );
}
