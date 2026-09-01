"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ParkingSpot } from "@/lib/types";

type Point = [number, number];

interface ParkingSpotsEditorProps {
  camId: string;
  spots: ParkingSpot[];
  onChange: (next: ParkingSpot[]) => void;
}

const CLOSE_RADIUS = 0.03;
const FILL = [
  "rgba(52, 211, 153, 0.28)",
  "rgba(96, 165, 250, 0.28)",
  "rgba(251, 191, 36, 0.28)",
  "rgba(244, 114, 182, 0.28)",
  "rgba(167, 139, 250, 0.28)",
];
const STROKE = [
  "rgb(52 211 153)",
  "rgb(96 165 250)",
  "rgb(251 191 36)",
  "rgb(244 114 182)",
  "rgb(167 139 250)",
];

function dist(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function nextId(spots: ParkingSpot[]): string {
  const used = new Set(spots.map((s) => s.id));
  let n = spots.length + 1;
  while (used.has(`p${n}`)) n += 1;
  return `p${n}`;
}

function nextName(spots: ParkingSpot[]): string {
  return String(spots.length + 1);
}

/**
 * Mehrere Parkboxen auf dem Snapshot zeichnen.
 * Jede geschlossene Fläche ist eine Box; Namen lassen sich in der Liste ändern.
 */
export function ParkingSpotsEditor({
  camId,
  spots,
  onChange,
}: ParkingSpotsEditorProps) {
  const [snapshotKey, setSnapshotKey] = useState(0);
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  const [draft, setDraft] = useState<Point[]>([]);
  const [liveDebug, setLiveDebug] = useState(false);

  useEffect(() => {
    if (!liveDebug) return;
    const id = setInterval(() => setSnapshotKey((k) => k + 1), 1500);
    return () => clearInterval(id);
  }, [liveDebug]);

  const snapshotUrl = liveDebug
    ? `/api/cams/${encodeURIComponent(camId)}/tracker-debug?ts=${snapshotKey}`
    : `/api/cams/${encodeURIComponent(camId)}/snapshot?ts=${snapshotKey}`;
  const aspect = imgSize ? `${imgSize.w} / ${imgSize.h}` : "16 / 9";
  const drawing = !liveDebug;

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!drawing) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const next: Point = [
      Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    ];
    if (draft.length >= 3 && dist(next, draft[0]) <= CLOSE_RADIUS) {
      commitDraft(draft);
      return;
    }
    setDraft((d) => [...d, next]);
  }

  function commitDraft(points: Point[]) {
    if (points.length < 3) return;
    onChange([
      ...spots,
      { id: nextId(spots), name: nextName(spots), zone: points },
    ]);
    setDraft([]);
  }

  return (
    <div className="space-y-2">
      <div
        onClick={handleClick}
        className={`relative overflow-hidden rounded-lg border border-foreground/15 bg-black/40 ${
          drawing ? "cursor-crosshair" : "cursor-default"
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
          {spots.map((spot, i) => {
            const pts = spot.zone.map((p) => `${p[0] * 100},${p[1] * 100}`).join(" ");
            const cx = (spot.zone.reduce((s, p) => s + p[0], 0) / spot.zone.length) * 100;
            const cy = (spot.zone.reduce((s, p) => s + p[1], 0) / spot.zone.length) * 100;
            return (
              <g key={spot.id}>
                <polygon
                  points={pts}
                  fill={FILL[i % FILL.length]}
                  stroke={STROKE[i % STROKE.length]}
                  strokeWidth="0.5"
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  x={cx}
                  y={cy}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="white"
                  fontSize="3.2"
                  fontWeight="600"
                >
                  {spot.name}
                </text>
              </g>
            );
          })}
          {draft.length >= 2 && (
            <polygon
              points={draft.map((p) => `${p[0] * 100},${p[1] * 100}`).join(" ")}
              fill="rgba(255,255,255,0.08)"
              stroke="white"
              strokeWidth="0.5"
              strokeDasharray="1.4 1"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {draft.map((p, i) => (
            <circle
              key={`d-${i}`}
              cx={p[0] * 100}
              cy={p[1] * 100}
              r={i === 0 ? 1.2 : 0.8}
              fill={i === 0 ? "rgb(250 204 21)" : "white"}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
        {draft.length === 0 && spots.length === 0 && (
          <div className="absolute inset-x-0 bottom-2 mx-auto w-fit rounded-full bg-black/70 px-3 py-1 text-xs text-white/90">
            Parkbox umklicken (mind. 3 Ecken)
          </div>
        )}
        {draft.length > 0 && draft.length < 3 && (
          <div className="absolute inset-x-0 bottom-2 mx-auto w-fit rounded-full bg-black/70 px-3 py-1 text-xs text-white/90">
            Noch {3 - draft.length} Punkt{3 - draft.length === 1 ? "" : "e"} …
          </div>
        )}
        {draft.length >= 3 && (
          <div className="absolute inset-x-0 bottom-2 mx-auto w-fit rounded-full bg-black/70 px-3 py-1 text-xs text-white/90">
            Ersten Punkt erneut klicken oder „Box schließen“
          </div>
        )}
      </div>

      {spots.length > 0 && (
        <ul className="grid gap-1 sm:grid-cols-2">
          {spots.map((spot, i) => (
            <li
              key={spot.id}
              className="flex items-center gap-2 rounded-md border border-foreground/10 px-2 py-1"
            >
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: STROKE[i % STROKE.length] }}
              />
              <Input
                value={spot.name}
                onChange={(e) => {
                  const name = e.target.value.slice(0, 40) || spot.name;
                  onChange(
                    spots.map((s) => (s.id === spot.id ? { ...s, name } : s)),
                  );
                }}
                className="h-8"
              />
              <Button
                variant="ghost"
                onClick={(e) => {
                  e.preventDefault();
                  onChange(spots.filter((s) => s.id !== spot.id));
                }}
              >
                Weg
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-foreground/60">
        <div>
          {imgSize && (
            <span>
              Snapshot: {imgSize.w}×{imgSize.h}
            </span>
          )}
          <span className="ml-2">
            {spots.length} Box{spots.length === 1 ? "" : "en"}
          </span>
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
            disabled={spots.length === 0}
            title="Tracker-Bild mit belegten/freien Boxen"
          >
            {liveDebug ? "Live-Tracker an" : "Live-Tracker"}
          </Button>
          {draft.length >= 3 && (
            <Button
              variant="ghost"
              onClick={(e) => {
                e.preventDefault();
                commitDraft(draft);
              }}
            >
              Box schließen
            </Button>
          )}
          {draft.length > 0 && (
            <Button
              variant="ghost"
              onClick={(e) => {
                e.preventDefault();
                setDraft((d) => d.slice(0, -1));
              }}
            >
              Letzten Punkt löschen
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
