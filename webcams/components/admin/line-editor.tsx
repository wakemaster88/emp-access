"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type Point = [number, number]; // normiert 0..1
type Line = [Point, Point];

interface LineEditorProps {
  camId: string;
  /** Aktuelle Linie (normierte Koordinaten) oder null = noch keine. */
  value: Line | null;
  onChange: (next: Line | null) => void;
  /** Pfeilrichtung: definiert welche Seite als „rein" gilt. */
  direction: "ab" | "ba";
  onDirectionChange: (next: "ab" | "ba") => void;
}

/**
 * Linien-Editor für Crossing-Counter.
 *
 * Workflow: User klickt zwei Punkte aufs Snapshot. Pfeil zeigt von Punkt A
 * nach B; Personen, die in Pfeilrichtung kreuzen, zählen als „rein".
 * Die Richtung lässt sich per Button drehen, ohne die Punkte neu zu setzen.
 *
 * Koordinaten werden normiert (0..1) gespeichert, damit ein Wechsel der
 * Substream-Auflösung nichts kaputt macht.
 */
export function LineEditor({
  camId,
  value,
  onChange,
  direction,
  onDirectionChange,
}: LineEditorProps) {
  const [snapshotKey, setSnapshotKey] = useState(0);
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [draft, setDraft] = useState<Point | null>(null);
  const [liveDebug, setLiveDebug] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Im "live"-Modus zeigen wir den annotierten Tracker-Frame (Detections,
  // Track-IDs, Linie, Counts) statt des Roh-Snapshots — praktisch zum
  // Verifizieren ob die Linie an einer sinnvollen Stelle liegt.
  const snapshotUrl = liveDebug
    ? `/api/cams/${encodeURIComponent(camId)}/tracker-debug?ts=${snapshotKey}`
    : `/api/cams/${encodeURIComponent(camId)}/snapshot?ts=${snapshotKey}`;

  // Im Live-Modus alle 1.5 s automatisch refreshen.
  useEffect(() => {
    if (!liveDebug) return;
    const id = setInterval(() => setSnapshotKey((k) => k + 1), 1500);
    return () => clearInterval(id);
  }, [liveDebug]);

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (liveDebug) return; // im Live-Modus nur anschauen
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const clamped: Point = [
      Math.max(0, Math.min(1, x)),
      Math.max(0, Math.min(1, y)),
    ];

    if (draft === null && !value) {
      setDraft(clamped);
      return;
    }
    if (draft !== null) {
      onChange([draft, clamped]);
      setDraft(null);
      return;
    }
    // Bereits eine vollständige Linie da → klick = neuer Anfang
    setDraft(clamped);
    onChange(null);
  }

  const a = value?.[0] ?? draft;
  const b = value?.[1];

  const arrowFrom = direction === "ab" ? a : b;
  const arrowTo = direction === "ab" ? b : a;

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        onClick={handleClick}
        className={`relative overflow-hidden rounded-lg border border-foreground/15 bg-black/40 ${
          liveDebug ? "cursor-default" : "cursor-crosshair"
        }`}
        style={{ aspectRatio: "16 / 9" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={snapshotUrl}
          alt={`Snapshot ${camId}`}
          onLoad={(e) => {
            const img = e.currentTarget;
            setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
          }}
          className="absolute inset-0 h-full w-full object-contain pointer-events-none select-none"
          draggable={false}
        />
        {/* Im Live-Modus zeichnet der Sidecar Linie + Pfeil schon ins JPEG;
            unsere SVG-Overlay wird dann ausgeblendet, damit's nicht doppelt malt. */}
        <svg
          className={`absolute inset-0 h-full w-full pointer-events-none ${
            liveDebug ? "hidden" : ""
          }`}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          {value && (
            <line
              x1={value[0][0] * 100}
              y1={value[0][1] * 100}
              x2={value[1][0] * 100}
              y2={value[1][1] * 100}
              stroke="rgb(34 211 238)"
              strokeWidth="0.6"
              strokeDasharray="1.5 1"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {value && arrowFrom && arrowTo && (
            <ArrowMarker from={arrowFrom} to={arrowTo} />
          )}
          {a && (
            <circle
              cx={a[0] * 100}
              cy={a[1] * 100}
              r="0.9"
              fill="rgb(34 211 238)"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {b && (
            <circle
              cx={b[0] * 100}
              cy={b[1] * 100}
              r="0.9"
              fill="rgb(34 211 238)"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        {!value && draft === null && (
          <div className="absolute inset-x-0 bottom-2 mx-auto w-fit rounded-full bg-black/70 px-3 py-1 text-xs text-white/90">
            Klick auf zwei Punkte, um die Zähllinie zu setzen
          </div>
        )}
        {draft !== null && !value && (
          <div className="absolute inset-x-0 bottom-2 mx-auto w-fit rounded-full bg-black/70 px-3 py-1 text-xs text-white/90">
            Zweiten Punkt setzen…
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-foreground/60">
        <div>
          {imgSize && (
            <span>
              Substream: {imgSize.w}×{imgSize.h}
            </span>
          )}
          {value && (
            <span className="ml-2">
              A ({(value[0][0] * 100).toFixed(0)}%, {(value[0][1] * 100).toFixed(0)}%) → B (
              {(value[1][0] * 100).toFixed(0)}%, {(value[1][1] * 100).toFixed(0)}%)
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          <Button
            variant="ghost"
            onClick={(e) => {
              e.preventDefault();
              setSnapshotKey((k) => k + 1);
            }}
          >
            Snapshot neu
          </Button>
          <Button
            variant={liveDebug ? "primary" : "ghost"}
            onClick={(e) => {
              e.preventDefault();
              setLiveDebug((v) => !v);
              setSnapshotKey((k) => k + 1);
            }}
            disabled={!value}
            title="Zeigt das Bild des Trackers mit Detections und Counts"
          >
            {liveDebug ? "Live-Tracker an" : "Live-Tracker"}
          </Button>
          <Button
            variant="ghost"
            onClick={(e) => {
              e.preventDefault();
              onDirectionChange(direction === "ab" ? "ba" : "ab");
            }}
            disabled={!value || liveDebug}
          >
            Richtung tauschen ({direction === "ab" ? "A→B = rein" : "B→A = rein"})
          </Button>
          <Button
            variant="ghost"
            onClick={(e) => {
              e.preventDefault();
              onChange(null);
              setDraft(null);
            }}
            disabled={(!value && draft === null) || liveDebug}
          >
            Linie löschen
          </Button>
          <Button
            variant="ghost"
            onClick={async (e) => {
              e.preventDefault();
              await fetch(
                `/api/cams/${encodeURIComponent(camId)}/tracker-reset`,
                { method: "POST" },
              );
              setSnapshotKey((k) => k + 1);
            }}
            disabled={!liveDebug}
            title="Setzt in/out-Zähler dieser Cam auf 0"
          >
            Zähler reset
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Pfeilspitze in der Mitte der Linie, zeigt von `from` nach `to`.
 * Wir rechnen alles in Prozent (viewBox 0..100), damit der Pfeil sich
 * mit dem Container skaliert.
 */
function ArrowMarker({ from, to }: { from: Point; to: Point }) {
  const x1 = from[0] * 100;
  const y1 = from[1] * 100;
  const x2 = to[0] * 100;
  const y2 = to[1] * 100;
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;

  // Pfeilspitze (Dreieck)
  const SIZE = 3.5;
  const px = cx + ux * SIZE;
  const py = cy + uy * SIZE;
  // senkrechter Vektor
  const nx = -uy;
  const ny = ux;
  const left = `${cx - ux * SIZE + nx * SIZE * 0.6},${cy - uy * SIZE + ny * SIZE * 0.6}`;
  const right = `${cx - ux * SIZE - nx * SIZE * 0.6},${cy - uy * SIZE - ny * SIZE * 0.6}`;

  return (
    <polygon
      points={`${px},${py} ${left} ${right}`}
      fill="rgb(34 211 238)"
      stroke="rgb(8 51 68)"
      strokeWidth="0.2"
      vectorEffect="non-scaling-stroke"
    />
  );
}
