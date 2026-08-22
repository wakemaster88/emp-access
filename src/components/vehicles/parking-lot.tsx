"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Car, Cctv, Link2, ParkingSquare, Wifi, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
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
    const t = setInterval(tick, 8_000);
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
      <Card className="border-dashed border-slate-300 dark:border-slate-700">
        <CardContent className="py-12 text-center text-slate-500">
          <ParkingSquare className="h-10 w-10 mx-auto mb-3 text-slate-300" />
          <p className="font-medium">Keine Parkfläche gemeldet</p>
          <p className="text-sm mt-1 max-w-md mx-auto">
            Die Zonen kommen vom Hub-Kiosk (Ausfahrt-/Parkfläche an der Kamera,
            aktuell Halle). Sobald der Hub den Tracker-Stand schickt, erscheint
            die Belegung hier.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Card className="py-3 px-4 gap-0">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-500">Fahrzeuge in Fläche</span>
            <ParkingSquare className={cn("h-3.5 w-3.5", occupiedCount > 0 ? "text-amber-500" : "text-slate-400")} />
          </div>
          <p className="text-2xl font-bold tabular-nums mt-1">
            {waitingForHub ? "…" : occupiedCount}
          </p>
          <p className="text-[10px] text-slate-400 mt-0.5">
            {waitingForHub
              ? "warte auf Hub-Tracker"
              : live.parking?.trackerOnline
                ? "YOLO-Tracker"
                : "Tracker offline"}
          </p>
        </Card>
        <Card className="py-3 px-4 gap-0">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-500">Hub</span>
            {live.hubOnline ? (
              <Wifi className="h-3.5 w-3.5 text-emerald-500" />
            ) : (
              <WifiOff className="h-3.5 w-3.5 text-rose-500" />
            )}
          </div>
          <p className={cn("text-lg font-bold mt-1", live.hubOnline ? "text-emerald-600" : "text-rose-600")}>
            {live.hubOnline ? "online" : "offline"}
          </p>
          <p className="text-[10px] text-slate-400 mt-0.5 truncate">
            {live.hubName ?? "kein Agent"}
          </p>
        </Card>
        <Card className="py-3 px-4 gap-0 col-span-2 sm:col-span-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-500">Letztes Kennzeichen</span>
            <Car className="h-3.5 w-3.5 text-slate-400" />
          </div>
          <p className="text-lg font-bold font-mono mt-1 truncate">
            {sightings[0]?.plate ?? "—"}
          </p>
          <p className="text-[10px] text-slate-400 mt-0.5 truncate">
            {sightings[0]
              ? `${sightings[0].camera?.name ?? "Kamera"} · ${ago(sightings[0].seenAt)}`
              : "Einfahrt / ALPR"}
          </p>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {matchedLots.map(({ lot, cam }) => {
          const count = lot?.count ?? 0;
          const occupiedNow = count > 0;
          const key = lot?.kioskId || cam?.id || "lot";
          const title = cam?.name ?? lot?.name ?? "Parkfläche";
          return (
            <Card
              key={key}
              className={cn(
                "overflow-hidden py-0 gap-0",
                occupiedNow && "border-amber-300 dark:border-amber-800",
              )}
            >
              <div className="relative aspect-video bg-slate-100 dark:bg-slate-900">
                {cam?.snapshotAt ? (
                  <img
                    src={`/api/cameras/${cam.id}/snapshot?t=${encodeURIComponent(cam.snapshotAt)}`}
                    alt=""
                    className="h-full w-full object-contain bg-slate-950"
                  />
                ) : (
                  <div className="h-full w-full flex items-center justify-center text-slate-400">
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
                    <polygon
                      points={lot.zone.map(([x, y]) => `${x},${y}`).join(" ")}
                      fill={occupiedNow ? "rgba(245,158,11,0.32)" : "rgba(16,185,129,0.22)"}
                      stroke={occupiedNow ? "rgb(245,158,11)" : "rgb(16,185,129)"}
                      strokeWidth={0.006}
                    />
                  </svg>
                )}
                <div className="absolute top-2 left-2">
                  <Badge
                    className={cn(
                      "text-[10px] gap-1",
                      occupiedNow ? "bg-amber-500 text-white" : "bg-slate-900/70 text-white",
                    )}
                  >
                    {waitingForHub
                      ? "Parkfläche Halle"
                      : occupiedNow
                        ? `${count} Fahrzeug${count === 1 ? "" : "e"}`
                        : "frei"}
                  </Badge>
                </div>
              </div>
              <CardContent className="p-3 space-y-1">
                <div className="flex items-center justify-between gap-2 min-w-0">
                  <p className="text-sm font-semibold truncate">{title}</p>
                  <span className="text-[10px] text-slate-400 shrink-0">
                    {lot ? agoMs(lot.lastUpdate) : cam ? ago(cam.lastSeenAt) : ""}
                  </span>
                </div>
                {lot?.lastError ? (
                  <p className="text-[11px] text-rose-500 truncate">{lot.lastError}</p>
                ) : (
                  <p className="text-[11px] text-slate-400">
                    {waitingForHub
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
          <p className="text-xs font-medium text-slate-500">Letzte Kennzeichen (Einfahrt)</p>
          <div className="grid gap-2">
            {sightings.slice(0, 5).map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2"
              >
                {s.hasSnapshot ? (
                  <img
                    src={`/api/vehicle-sightings/${s.id}/snapshot`}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="h-10 w-10 rounded object-cover shrink-0"
                  />
                ) : (
                  <div className="h-10 w-10 rounded bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                    <Car className="h-4 w-4 text-slate-400" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-mono font-semibold truncate">
                    {s.plate ?? "ohne Kennzeichen"}
                  </p>
                  <p className="text-[10px] text-slate-400 truncate">
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
                    className="h-7 text-[11px] gap-1 shrink-0"
                    onClick={() => onAssign(s)}
                  >
                    <Link2 className="h-3 w-3" />
                    Zuordnen
                  </Button>
                )}
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-400">Weitere Einträge im Tab Historie.</p>
        </div>
      )}
    </div>
  );
}
