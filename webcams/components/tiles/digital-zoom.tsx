"use client";

import { useEffect, useRef, useState } from "react";
import { Minus, Pin, PinOff, Plus, RotateCcw } from "lucide-react";
import type { WidgetView } from "@/lib/types";

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const BUTTON_STEP = 1.5;

interface DigitalZoomProps {
  children: React.ReactNode;
  className?: string;
  /** Gespeicherter Ausschnitt — wird beim Mount angefahren. */
  initialView?: WidgetView | null;
  /**
   * Wenn gesetzt: Pin-Button zum Fixieren des aktuellen Ausschnitts
   * (`null` = Fixierung aufheben). Der Parent persistiert.
   */
  onSaveView?: (view: WidgetView | null) => void;
}

/**
 * Digital-Zoom für den Fokus-Modus: skaliert den Video-/Bild-Inhalt per
 * CSS-Transform. Beim Main-Stream (bis 16 MP, z. B. Duo 3) bleibt das auch
 * bei 4–8x noch scharf.
 *
 * Bedienung:
 *   - Mausrad / Trackpad-Scroll: rein-/rauszoomen (auf den Cursor zentriert)
 *   - Ziehen: Ausschnitt verschieben (wenn gezoomt)
 *   - Doppelklick: 3x-Zoom auf die Klickstelle ↔ zurück auf 1x
 *   - Buttons unten rechts: Zoom −/+, Reset, Pin (Ausschnitt fixieren)
 */
export function DigitalZoom({
  children,
  className,
  initialView,
  onSaveView,
}: DigitalZoomProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [pinned, setPinned] = useState(!!initialView);
  const dragRef = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null);

  // Gespeicherten Ausschnitt beim Mount anfahren (braucht Container-Maße).
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !initialView) return;
    setScale(initialView.scale);
    setOffset({
      x: initialView.fx * el.clientWidth,
      y: initialView.fy * el.clientHeight,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Offset so begrenzen, dass der Inhalt den Container immer voll bedeckt. */
  const clamp = (x: number, y: number, s: number) => {
    const el = containerRef.current;
    if (!el) return { x: 0, y: 0 };
    const maxX = ((s - 1) * el.clientWidth) / 2;
    const maxY = ((s - 1) * el.clientHeight) / 2;
    return {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y)),
    };
  };

  const zoomAt = (clientX: number, clientY: number, nextScale: number) => {
    const el = containerRef.current;
    if (!el) return;
    const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, nextScale));
    const rect = el.getBoundingClientRect();
    // Cursor-Position relativ zur Container-Mitte
    const px = clientX - rect.left - rect.width / 2;
    const py = clientY - rect.top - rect.height / 2;
    setScale((prev) => {
      setOffset((prevOff) => {
        // Punkt unter dem Cursor beim Zoomen fixieren:
        // screen = p*s + t  →  t' = screen - (screen - t) * s'/s
        const nx = px - ((px - prevOff.x) * s) / prev;
        const ny = py - ((py - prevOff.y) * s) / prev;
        return clamp(nx, ny, s);
      });
      return s;
    });
  };

  const zoomCenter = (factor: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, scale * factor);
  };

  const reset = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  const togglePin = () => {
    if (!onSaveView) return;
    if (pinned) {
      setPinned(false);
      onSaveView(null);
      return;
    }
    const el = containerRef.current;
    if (!el || scale <= 1) return;
    setPinned(true);
    onSaveView({
      scale,
      fx: offset.x / el.clientWidth,
      fy: offset.y / el.clientHeight,
    });
  };

  // Wheel-Listener nicht-passiv registrieren, damit preventDefault die Seite
  // nicht scrollt (React-onWheel ist passiv).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      // scale aus dem State lesen wäre stale — über functional update lösen:
      setScale((prev) => {
        const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, prev * factor));
        const rect = el.getBoundingClientRect();
        const px = e.clientX - rect.left - rect.width / 2;
        const py = e.clientY - rect.top - rect.height / 2;
        setOffset((prevOff) => {
          const nx = px - ((px - prevOff.x) * s) / prev;
          const ny = py - ((py - prevOff.y) * s) / prev;
          const maxX = ((s - 1) * el.clientWidth) / 2;
          const maxY = ((s - 1) * el.clientHeight) / 2;
          return {
            x: Math.max(-maxX, Math.min(maxX, nx)),
            y: Math.max(-maxY, Math.min(maxY, ny)),
          };
        });
        return s;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (scale <= 1) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setOffset(clamp(d.ox + (e.clientX - d.startX), d.oy + (e.clientY - d.startY), scale));
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (scale > 1) reset();
    else zoomAt(e.clientX, e.clientY, 3);
  };

  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full overflow-hidden ${className ?? ""}`}
      style={{ cursor: scale > 1 ? "grab" : undefined, touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
    >
      <div
        className="h-full w-full"
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          transformOrigin: "center center",
          transition: dragRef.current ? undefined : "transform 120ms ease-out",
        }}
      >
        {children}
      </div>

      {/* Zoom-Controls unten rechts */}
      <div className="absolute bottom-2 right-2 z-10 flex items-center gap-1 rounded-full bg-black/60 p-1 ring-1 ring-white/15 backdrop-blur-sm">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            zoomCenter(1 / BUTTON_STEP);
          }}
          disabled={scale <= MIN_SCALE}
          aria-label="Digital rauszoomen"
          className="inline-flex size-7 items-center justify-center rounded-full text-white/80 hover:bg-white/10 hover:text-white disabled:opacity-30"
        >
          <Minus className="size-4" />
        </button>
        <span className="min-w-10 text-center text-xs tabular-nums text-white/80">
          {scale.toFixed(1)}x
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            zoomCenter(BUTTON_STEP);
          }}
          disabled={scale >= MAX_SCALE}
          aria-label="Digital reinzoomen"
          className="inline-flex size-7 items-center justify-center rounded-full text-white/80 hover:bg-white/10 hover:text-white disabled:opacity-30"
        >
          <Plus className="size-4" />
        </button>
        {scale > 1 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              reset();
            }}
            aria-label="Zoom zurücksetzen"
            className="inline-flex size-7 items-center justify-center rounded-full text-white/80 hover:bg-white/10 hover:text-white"
          >
            <RotateCcw className="size-3.5" />
          </button>
        )}
        {onSaveView && (scale > 1 || pinned) && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              togglePin();
            }}
            aria-label={
              pinned
                ? "Fixierten Ausschnitt aufheben"
                : "Ausschnitt für die Übersicht fixieren"
            }
            title={
              pinned
                ? "Fixierten Ausschnitt aufheben"
                : "Ausschnitt für die Übersicht fixieren"
            }
            className={`inline-flex size-7 items-center justify-center rounded-full hover:bg-white/10 ${
              pinned ? "text-amber-300 hover:text-amber-200" : "text-white/80 hover:text-white"
            }`}
          >
            {pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Statischer, nicht-interaktiver fixierter Ausschnitt für Grid-Kacheln.
 * Wendet den gespeicherten View als CSS-Transform an (translate in % der
 * Kachelgröße — dadurch unabhängig von der tatsächlichen Pixelgröße).
 */
export function FixedView({
  view,
  children,
}: {
  view: WidgetView;
  children: React.ReactNode;
}) {
  return (
    <div className="h-full w-full overflow-hidden">
      <div
        className="h-full w-full"
        style={{
          transform: `translate(${view.fx * 100}%, ${view.fy * 100}%) scale(${view.scale})`,
          transformOrigin: "center center",
        }}
      >
        {children}
      </div>
    </div>
  );
}
