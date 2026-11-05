"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconChip } from "@/components/ui/icon-chip";
import { SectionHeading } from "@/components/ui/section-heading";
import { StatCard } from "@/components/ui/stat-card";
import { StatusDot } from "@/components/ui/status-dot";
import { Car, Cctv, Link2, ParkingSquare, Wifi, WifiOff } from "lucide-react";
import {
  fallbackParkingCameras,
  matchParkingCamera,
  type ParkingCamMatch,
  type ParkingLotReport,
  type ParkingSnapshot,
} from "@/lib/parking";

export interface ParkingSighting {
  id: number;
  plate: string | null;
  matched: boolean;
  seenAt: string;
  hasSnapshot: boolean;
  camera: { id: number; name: string } | null;
  allowedVehicle: { id: number; name: string; plate: string } | null;
}

interface ParkingApi {
  hubOnline: boolean;
  hubName: string | null;
  parking: ParkingSnapshot | null;
  cameras: ParkingCamMatch[];
}

interface Props {
  cameras: ParkingCamMatch[];
  hubOnline: boolean;
  hubName: string | null;
  parking: ParkingSnapshot | null;
  sightings: ParkingSighting[];
  onAssign: (s: ParkingSighting) => void;
}

function ago(iso: string | null): string {
  if (!iso) return "nie";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 10) return "gerade eben";
  if (s < 60) return `vor ${s} s`;
  if (s < 3600) return `vor ${Math.floor(s / 60)} Min.`;
  return `vor ${Math.floor(s / 3600)} Std.`;
}

function agoMs(ts: number): string {
  if (!ts) return "keine Tracker-Daten";
  return ago(new Date(ts).toISOString());
}

export function ParkingLot({
  cameras,
  hubOnline,
  hubName,
  parking,
  sightings,
  onAssign,
}: Props) {
  const [live, setLive] = useState<ParkingApi>({
    cameras,
    hubOnline,
    hubName,
    parking,
  });
  const [, setNow] = useState(0);

  useEffect(() => {
    setLive({ cameras, hubOnline, hubName, parking });
  }, [cameras, hubOnline, hubName, parking]);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const res = await fetch("/api/parking");
        if (!res.ok) return;
        const data = (await res.json()) as ParkingApi;
        if (!cancelled) setLive(data);
      } catch {
        /* ignore */
      }
    }
    void tick();
    const t = setInterval(tick, 15_000);
    const clock = setInterval(() => setNow((n) => n + 1), 10_000);
    return () => {
      cancelled = true;
      clearInterval(t);
      clearInterval(clock);
    };
  }, []);

  const lots = live.parking?.lots ?? [];
  const matchedLots = useMemo(() => {
    if (lots.length > 0) {
      return lots.map((lot) => ({
        lot,
        cam: matchParkingCamera(lot, live.cameras),
      }));
    }
    return fallbackParkingCameras(live.cameras).map((cam) => ({
      lot: null as ParkingLotReport | null,
      cam,
    }));
  }, [lots, live.cameras]);

  const occupiedCount = lots.reduce((sum, l) => sum + l.count, 0);
  const waitingForHub = lots.length === 0 && matchedLots.length > 0;

  if (matchedLots.length === 0) {
    return (
      <Card className="py-0 sm:py-0">
        <EmptyState
          icon={ParkingSquare}
          title="Keine Parkfläche gemeldet"
          description="Die Zonen kommen vom Hub-Kiosk (Ausfahrt-/Parkfläche an der Kamera, aktuell Halle). Sobald der Hub den Tracker-Stand schickt, erscheint die Belegung hier."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Kennzahlen: Handy eine Spalte, ab sm zwei (letztes Kennzeichen darunter über die volle Breite), drei erst ab lg – schmaler kürzt StatCard Beschriftung, Hinweis und Kennzeichen. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <StatCard
          label="Fahrzeuge in Fläche"
          value={waitingForHub ? "…" : occupiedCount}
          icon={ParkingSquare}
          tone={occupiedCount > 0 ? "warning" : "neutral"}
          hint={
            waitingForHub
              ? "warte auf Hub-Tracker"
              : live.parking?.trackerOnline
                ? "YOLO-Tracker"
                : "Tracker offline"
          }
        />
        <StatCard
          label="Hub"
          value={live.hubOnline ? "online" : "offline"}
          icon={live.hubOnline ? Wifi : WifiOff}
          tone={live.hubOnline ? "success" : "danger"}
          accentValue
          hint={live.hubName ?? "kein Agent"}
        />
        <StatCard
          label="Letztes Kennzeichen"
          value={sightings[0]?.plate ?? "—"}
          icon={Car}
          tone="neutral"
          hint={
            sightings[0]
              ? `${sightings[0].camera?.name ?? "Kamera"} · ${ago(sightings[0].seenAt)}`
              : "Einfahrt / ALPR"
          }
          className="sm:col-span-2 lg:col-span-1"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5">
        {matchedLots.map(({ lot, cam }) => {
          const count = lot?.count ?? 0;
          const occupiedNow = count > 0;
          const key = lot?.kioskId || cam?.id || "lot";
          const title = cam?.name ?? lot?.name ?? "Parkfläche";
          const unmatched = !!lot?.ip && !cam;
          return (
            <Card key={key} className="overflow-hidden py-0 sm:py-0 gap-0">
              {/* Kamerabild-Rahmen immer schwarz (Ausnahme laut Farbregeln), auch ohne Bild. `dark` gibt Fläche,
                  Punkt und Platzhalter die Töne des dunklen Modus, damit sie auf dem Bild in Hell und Dunkel gleich leuchten. */}
              <div className="dark relative aspect-video bg-black">
                {cam?.snapshotAt ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/cameras/${cam.id}/snapshot?t=${encodeURIComponent(cam.snapshotAt)}`}
                    alt=""
                    className="h-full w-full object-contain bg-black"
                  />
                ) : (
                  <div className="h-full w-full flex items-center justify-center text-muted-foreground">
                    <Cctv className="h-8 w-8" />
                  </div>
                )}
                {lot?.zone && lot.zone.length >= 3 && (
                  <svg
                    className="absolute inset-0 h-full w-full pointer-events-none"
                    viewBox="0 0 1 1"
                    preserveAspectRatio="none"
                    aria-hidden
                  >
                    {/* Fläche in Zustandsfarbe: belegt Warnung, frei Erfolg. */}
                    <polygon
                      points={lot.zone.map(([x, y]) => `${x},${y}`).join(" ")}
                      className={occupiedNow ? "fill-warning/30 stroke-warning" : "fill-success/20 stroke-success"}
                      strokeWidth={0.006}
                    />
                  </svg>
                )}
                <div className="absolute top-2 left-2">
                  {/* Plakette über dem Kamerabild: dunkel wie Kamerabilder (Ausnahme laut Farbregeln), damit sie auf jedem Bild lesbar bleibt; belegt zeigt zusätzlich einen Warnpunkt. */}
                  <Badge className="gap-1.5 bg-black/60 text-white">
                    {occupiedNow && <StatusDot tone="warning" />}
                    {waitingForHub
                      ? "Parkfläche Halle"
                      : occupiedNow
                        ? `${count} Fahrzeug${count === 1 ? "" : "e"}`
                        : "frei"}
                  </Badge>
                </div>
              </div>
              <CardContent className="space-y-1 py-3">
                <div className="flex items-center justify-between gap-2 min-w-0">
                  <p className="text-sm font-semibold truncate">{title}</p>
                  <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                    {lot ? agoMs(lot.lastUpdate) : cam ? ago(cam.lastSeenAt) : ""}
                  </span>
                </div>
                {lot?.lastError ? (
                  <p className="text-[11px] text-destructive truncate">{lot.lastError}</p>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    {unmatched
                      ? `Neue Kamera ${lot?.ip} – Bild kommt nach Hub-Update.`
                      : waitingForHub
                        ? "Hub-Update ausstehend — Fläche liegt an dieser Kamera."
                        : live.parking?.trackerOnline
                          ? `Belegung der gezeichneten Fläche · ${lot?.fps ?? 0} fps`
                          : "Tracker am Hub nicht erreichbar."}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {sightings.length > 0 && (
        <div className="space-y-2">
          <SectionHeading title="Letzte Kennzeichen (Einfahrt)" />
          {/* Kurze Liste: Zeilen mit Haarlinie in einer Karte. */}
          <Card className="gap-0 py-0 sm:py-0 overflow-hidden divide-y divide-border">
            {sightings.slice(0, 5).map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-3 px-4 py-2.5 sm:px-[18px]"
              >
                {s.hasSnapshot ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/vehicle-sightings/${s.id}/snapshot`}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="h-10 w-10 rounded-control bg-muted object-cover shrink-0"
                  />
                ) : (
                  <IconChip icon={Car} size="lg" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-mono font-semibold truncate">
                    {s.plate ?? "ohne Kennzeichen"}
                  </p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {s.allowedVehicle?.name ?? "unbekannt"}
                    {s.camera ? ` · ${s.camera.name}` : ""}
                    {" · "}
                    {ago(s.seenAt)}
                  </p>
                </div>
                {!s.matched && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1 shrink-0 max-sm:h-11"
                    onClick={() => onAssign(s)}
                  >
                    <Link2 className="h-3.5 w-3.5" />
                    Zuordnen
                  </Button>
                )}
              </div>
            ))}
          </Card>
          <p className="text-[11px] text-muted-foreground">Weitere Einträge im Tab Historie.</p>
        </div>
      )}
    </div>
  );
}
