"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Car, Cctv, Link2, ParkingSquare, Wifi, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ParkingCam {
  id: number;
  name: string;
  kind: string;
  vehicleDetection: boolean;
  snapshotAt: string | null;
  lastSeenAt: string | null;
}

export interface OpenVehicleEvent {
  id: number;
  cameraId: number;
  startedAt: string;
}

export interface ParkingSighting {
  id: number;
  plate: string | null;
  matched: boolean;
  seenAt: string;
  hasSnapshot: boolean;
  camera: { id: number; name: string } | null;
  allowedVehicle: { id: number; name: string; plate: string } | null;
}

interface CameraEventPayload {
  id: number;
  cameraId: number;
  type: string;
  startedAt: string;
  endedAt: string | null;
}

interface Props {
  cameras: ParkingCam[];
  hubOnline: boolean;
  hubName: string | null;
  initialOpen: OpenVehicleEvent[];
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

function since(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} Min.`;
  return `${Math.floor(s / 3600)} Std.`;
}

export function ParkingLot({
  cameras,
  hubOnline,
  hubName,
  initialOpen,
  sightings,
  onAssign,
}: Props) {
  const router = useRouter();
  const [, setNow] = useState(0);
  const [open, setOpen] = useState(initialOpen);

  useEffect(() => {
    setOpen(initialOpen);
  }, [initialOpen]);

  useEffect(() => {
    const t = setInterval(() => {
      setNow((n) => n + 1);
      router.refresh();
    }, 20_000);
    return () => clearInterval(t);
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const res = await fetch("/api/camera-events?minutes=30");
        if (!res.ok) return;
        const events = (await res.json()) as CameraEventPayload[];
        if (cancelled) return;
        setOpen(
          events
            .filter((e) => e.type === "VEHICLE" && e.endedAt == null)
            .map((e) => ({ id: e.id, cameraId: e.cameraId, startedAt: e.startedAt }))
        );
      } catch {
        /* ignore */
      }
    }
    void tick();
    const t = setInterval(tick, 8_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const [cams, setCams] = useState(cameras);

  useEffect(() => {
    setCams(cameras);
  }, [cameras]);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const res = await fetch("/api/cameras");
        if (!res.ok) return;
        const list = (await res.json()) as ParkingCam[];
        if (cancelled) return;
        setCams(
          list.map((c) => ({
            ...c,
            snapshotAt: c.snapshotAt ? String(c.snapshotAt) : null,
            lastSeenAt: c.lastSeenAt ? String(c.lastSeenAt) : null,
          })),
        );
      } catch {
        /* ignore */
      }
    }
    void tick();
    const t = setInterval(tick, 15_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const lots = cams.filter((c) => c.vehicleDetection);
  const openByCam = useMemo(() => {
    const m = new Map<number, OpenVehicleEvent>();
    for (const e of open) m.set(e.cameraId, e);
    return m;
  }, [open]);

  const lastByCam = useMemo(() => {
    const m = new Map<number, ParkingSighting>();
    for (const s of sightings) {
      const id = s.camera?.id;
      if (id == null || m.has(id)) continue;
      m.set(id, s);
    }
    return m;
  }, [sightings]);

  const occupied = lots.filter((c) => openByCam.has(c.id)).length;

  if (lots.length === 0) {
    return (
      <Card className="border-dashed border-slate-300 dark:border-slate-700">
        <CardContent className="py-12 text-center text-slate-500">
          <ParkingSquare className="h-10 w-10 mx-auto mb-3 text-slate-300" />
          <p className="font-medium">Keine Parkplatz-Kamera</p>
          <p className="text-sm mt-1">
            Unter{" "}
            <Link href="/cameras" className="text-indigo-600 hover:underline">
              Kameras
            </Link>{" "}
            Fahrzeugerkennung einschalten — der Hub legt dann Belegung und
            Kennzeichen hier ab.
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
            <span className="text-[11px] font-medium text-slate-500">Belegt</span>
            <ParkingSquare className={cn("h-3.5 w-3.5", occupied > 0 ? "text-amber-500" : "text-slate-400")} />
          </div>
          <p className="text-2xl font-bold tabular-nums mt-1">
            {occupied}
            <span className="text-sm font-medium text-slate-500 ml-1">/ {lots.length}</span>
          </p>
          <p className="text-[10px] text-slate-400 mt-0.5">Kameras mit Fahrzeug</p>
        </Card>
        <Card className="py-3 px-4 gap-0">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-500">Hub</span>
            {hubOnline ? (
              <Wifi className="h-3.5 w-3.5 text-emerald-500" />
            ) : (
              <WifiOff className="h-3.5 w-3.5 text-rose-500" />
            )}
          </div>
          <p className={cn("text-lg font-bold mt-1", hubOnline ? "text-emerald-600" : "text-rose-600")}>
            {hubOnline ? "online" : "offline"}
          </p>
          <p className="text-[10px] text-slate-400 mt-0.5 truncate">
            {hubName ?? "kein Agent"}
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
              : "noch keine Sichtung"}
          </p>
        </Card>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {lots.map((cam) => {
          const ev = openByCam.get(cam.id);
          const last = lastByCam.get(cam.id);
          const occupiedNow = !!ev;
          return (
            <Card
              key={cam.id}
              className={cn(
                "overflow-hidden py-0 gap-0",
                occupiedNow && "border-amber-300 dark:border-amber-800",
              )}
            >
              <div className="relative aspect-video bg-slate-100 dark:bg-slate-900">
                {cam.snapshotAt ? (
                  <img
                    src={`/api/cameras/${cam.id}/snapshot?t=${encodeURIComponent(cam.snapshotAt)}`}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="h-full w-full flex items-center justify-center text-slate-400">
                    <Cctv className="h-8 w-8" />
                  </div>
                )}
                <div className="absolute top-2 left-2">
                  <Badge
                    className={cn(
                      "text-[10px] gap-1",
                      occupiedNow
                        ? "bg-amber-500 text-white"
                        : "bg-slate-900/70 text-white",
                    )}
                  >
                    {ev ? `belegt · ${since(ev.startedAt)}` : "frei"}
                  </Badge>
                </div>
              </div>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center justify-between gap-2 min-w-0">
                  <p className="text-sm font-semibold truncate">{cam.name}</p>
                  <span className="text-[10px] text-slate-400 shrink-0">
                    {ago(cam.lastSeenAt)}
                  </span>
                </div>
                {last ? (
                  <div className="flex items-center gap-2 min-w-0">
                    {last.hasSnapshot ? (
                      <img
                        src={`/api/vehicle-sightings/${last.id}/snapshot`}
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
                        {last.plate ?? "ohne Kennzeichen"}
                      </p>
                      <p className="text-[10px] text-slate-400 truncate">
                        {last.allowedVehicle?.name ?? "unbekannt"} · {ago(last.seenAt)}
                      </p>
                    </div>
                    {!last.matched && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[11px] gap-1 shrink-0"
                        onClick={() => onAssign(last)}
                      >
                        <Link2 className="h-3 w-3" />
                        Zuordnen
                      </Button>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">Noch keine Sichtung an dieser Kamera.</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
