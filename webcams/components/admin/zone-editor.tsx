"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type Point = [number, number];

interface ZoneEditorProps {
  camId: string;
  /** Geschlossenes Polygon oder null. */
  value: Point[] | null;
  onChange: (next: Point[] | null) => void;
}

const CLOSE_RADIUS = 0.03;

function dist(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/**
 * Polygon-Editor für den Zonen-Zähler.
 *
 * Klicks setzen Eckpunkte auf dem Snapshot. Ab drei Punkten schließt ein
 * Klick in der Nähe des Starts (oder „Fläche schließen") das Polygon.
 * Koordinaten sind normiert (0..1), unabhängig von der Auflösung.
 */
export function ZoneEditor({ camId, value, onChange }: ZoneEditorProps) {
  const [snapshotKey, setSnapshotKey] = useState(0);
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [draft, setDraft] = useState<Point[]>([]);
  const [liveDebug, setLiveDebug] = useState(false);

  const closed = !!value && value.length >= 3;
  const points = closed ? value : draft;

  useEffect(() => {
    if (!liveDebug) return;
    const id = setInterval(() => setSnapshotKey((k) => k + 1), 1500);
    return () => clearInterval(id);
  }, [liveDebug]);

  const snapshotUrl = liveDebug
    ? `/api/cams/${encodeURIComponent(camId)}/tracker-debug?ts=${snapshotKey}`
    : `/api/cams/${encodeURIComponent(camId)}/snapshot?ts=${snapshotKey}`;

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (liveDebug || closed) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const next: Point = [
      Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    ];
    if (draft.length >= 3 && dist(next, draft[0]) <= CLOSE_RADIUS) {
      onChange(draft);
      setDraft([]);
      return;
    }
    setDraft((d) => [...d, next]);
  }

  const polyPoints = points.map((p) => `${p[0] * 100},${p[1] * 100}`).join(" ");
  const aspect = imgSize ? `${imgSize.w} / ${imgSize.h}` : "16 / 9";

  return (
    <div className="space-y-2">
      <div
        onClick={handleClick}
        className={`relative overflow-hidden rounded-lg border border-foreground/15 bg-black/40 ${
          liveDebug || closed ? "cursor-default" : "cursor-crosshair"
        }`}
        style={{ aspectRatio: aspect }}
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
        <svg
          className={`absolute inset-0 h-full w-full pointer-events-none ${
            liveDebug ? "hidden" : ""
          }`}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          {points.length >= 2 && (
            <polygon
              points={polyPoints}
              fill={closed ? "rgba(52, 211, 153, 0.22)" : "rgba(52, 211, 153, 0.08)"}
              stroke="rgb(52 211 153)"
              strokeWidth="0.5"
              strokeDasharray={closed ? undefined : "1.4 1"}
              vectorEffect="non-scaling-stroke"
            />
          )}
          {points.map((p, i) => (
            <circle
              key={`${p[0]}-${p[1]}-${i}`}
              cx={p[0] * 100}
              cy={p[1] * 100}
              r={i === 0 && !closed ? 1.2 : 0.8}
              fill={i === 0 && !closed ? "rgb(250 204 21)" : "rgb(52 211 153)"}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
        {!closed && draft.length === 0 && (
          <div className="absolute inset-x-0 bottom-2 mx-auto w-fit rounded-full bg-black/70 px-3 py-1 text-xs text-white/90">
            Eckpunkte der Fläche klicken (mind. 3)
          </div>
        )}
        {!closed && draft.length > 0 && draft.length < 3 && (
          <div className="absolute inset-x-0 bottom-2 mx-auto w-fit rounded-full bg-black/70 px-3 py-1 text-xs text-white/90">
            Noch {3 - draft.length} Punkt{3 - draft.length === 1 ? "" : "e"} …
          </div>
        )}
        {!closed && draft.length >= 3 && (
          <div className="absolute inset-x-0 bottom-2 mx-auto w-fit rounded-full bg-black/70 px-3 py-1 text-xs text-white/90">
            Ersten Punkt erneut klicken oder „Fläche schließen“
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-foreground/60">
        <div>
          {imgSize && (
            <span>
              Snapshot: {imgSize.w}×{imgSize.h}
            </span>
          )}
          {closed && (
            <span className="ml-2">{value.length} Eckpunkte</span>
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
            disabled={!closed}
            title="Zeigt das Bild des Trackers mit Detections und Zählstand"
          >
            {liveDebug ? "Live-Tracker an" : "Live-Tracker"}
          </Button>
          {!closed && (
            <Button
              variant="ghost"
              onClick={(e) => {
                e.preventDefault();
                if (draft.length >= 3) {
                  onChange(draft);
                  setDraft([]);
                }
              }}
              disabled={draft.length < 3}
            >
              Fläche schließen
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={(e) => {
              e.preventDefault();
              if (closed) {
                onChange(null);
                setDraft([]);
                return;
              }
              setDraft((d) => d.slice(0, -1));
            }}
            disabled={closed ? false : draft.length === 0 || liveDebug}
          >
            {closed ? "Fläche löschen" : "Letzten Punkt löschen"}
          </Button>
        </div>
      </div>
    </div>
  );
}
