"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Undo2, X } from "lucide-react";

export type ZonePoint = [number, number];

/**
 * Einfahrtszone auf dem Kamerabild anklicken. Punkte sind normiert (0..1),
 * damit sie unabhängig von der Auflösung des Hubs gelten. Weniger als drei
 * Punkte bedeuten „keine Zone“ – dann zählt nur die Mindestgröße.
 */
export function ZoneEditor({
  imageUrl,
  points,
  onChange,
}: {
  imageUrl: string | null;
  points: ZonePoint[];
  onChange: (points: ZonePoint[]) => void;
}) {
  const [broken, setBroken] = useState(false);

  function addPoint(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    if (points.length >= 32) return;
    onChange([...points, [Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000]]);
  }

  const path = points.map(([x, y]) => `${x * 100},${y * 100}`).join(" ");

  return (
    <div className="space-y-2">
      <div
        className="relative w-full overflow-hidden rounded-lg border border-border bg-muted aspect-video cursor-crosshair select-none"
        onClick={addPoint}
        role="img"
        aria-label="Kamerabild zum Markieren der Einfahrtszone"
      >
        {imageUrl && !broken ? (
          // Schnappschuss der Kamera; ohne Bild bleibt die Fläche leer, Punkte
          // lassen sich trotzdem setzen.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-fill"
            draggable={false}
            onError={() => setBroken(true)}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
            Kein Schnappschuss vorhanden. Erst „Schnappschuss“ in der Liste anfordern.
          </div>
        )}
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full pointer-events-none"
        >
          {points.length >= 3 && (
            <polygon points={path} fill="rgba(34,197,94,0.25)" stroke="rgb(34,197,94)" strokeWidth={0.4} />
          )}
          {points.length === 2 && (
            <line
              x1={points[0][0] * 100}
              y1={points[0][1] * 100}
              x2={points[1][0] * 100}
              y2={points[1][1] * 100}
              stroke="rgb(34,197,94)"
              strokeWidth={0.4}
            />
          )}
          {points.map(([x, y], i) => (
            <circle key={i} cx={x * 100} cy={y * 100} r={0.9} fill="rgb(34,197,94)" stroke="white" strokeWidth={0.25} />
          ))}
        </svg>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-muted-foreground flex-1">
          {points.length === 0
            ? "Klicken, um die Einfahrt einzurahmen. Ohne Zone zählt nur die Mindestgröße."
            : points.length < 3
              ? `${points.length} von mindestens 3 Punkten`
              : `${points.length} Punkte – nur Fahrzeuge mit Mittelpunkt in der Fläche zählen.`}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={points.length === 0}
          onClick={() => onChange(points.slice(0, -1))}
          className="gap-1"
        >
          <Undo2 className="h-3.5 w-3.5" />
          Letzten Punkt
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={points.length === 0}
          onClick={() => onChange([])}
          className="gap-1"
        >
          <X className="h-3.5 w-3.5" />
          Zone löschen
        </Button>
      </div>
    </div>
  );
}
