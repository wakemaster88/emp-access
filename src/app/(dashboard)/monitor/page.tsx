"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Header } from "@/components/layout/header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Maximize, Minimize, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { fmtTime } from "@/lib/utils";

interface MonitorScan {
  id: number;
  code: string;
  scanTime: string;
  result: "GRANTED" | "DENIED" | "PROTECTED";
  device: { name: string; type: string };
  ticket?: {
    name: string;
    firstName?: string | null;
    lastName?: string | null;
    validityType?: string;
    validityDurationMinutes?: number | null;
    firstScanAt?: string | null;
  } | null;
}

interface AreaCount {
  areaId: number;
  current: number;
  entries: number;
  exits: number;
}

interface DeviceStatus {
  id: number;
  name: string;
  type: string;
  isActive: boolean;
  lastUpdate: string | null;
  task: number;
}

export default function MonitorPage() {
  const [scans, setScans] = useState<MonitorScan[]>([]);
  const [newIds, setNewIds] = useState<Set<number>>(new Set());
  const [counts, setCounts] = useState<AreaCount[]>([]);
  const [devices, setDevices] = useState<DeviceStatus[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const isFirstLoad = useRef(true);

  const playAlertSound = useCallback(() => {
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
      const ctx = audioCtxRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.setValueAtTime(600, ctx.currentTime + 0.15);
      osc.frequency.setValueAtTime(400, ctx.currentTime + 0.3);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.45);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.45);
    } catch {}
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  }, []);

  useEffect(() => {
    if (isPaused) return;

    const eventSource = new EventSource("/api/monitor?areas=&devices=");

    eventSource.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      if (msg.type === "scans" && msg.data.length > 0) {
        const incoming = msg.data as MonitorScan[];
        setScans((prev) => {
          const existing = new Set(prev.map((s) => s.id));
          const fresh = incoming.filter((s) => !existing.has(s.id));
          if (!isFirstLoad.current && fresh.length > 0) {
            setNewIds(new Set(fresh.map((s) => s.id)));
            setTimeout(() => setNewIds(new Set()), 1500);
          }
          isFirstLoad.current = false;
          return [...fresh, ...prev].slice(0, 100);
        });

        if (soundEnabled && incoming.some((s) => s.result === "DENIED")) {
          playAlertSound();
        }
      }
      if (msg.type === "counts") setCounts(msg.data);
      if (msg.type === "devices") setDevices(msg.data);
    };

    return () => eventSource.close();
  }, [isPaused, soundEnabled, playAlertSound]);

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = 0;
    }
  }, [scans]);

  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  return (
    <div ref={containerRef} className="bg-slate-50 dark:bg-slate-950 min-h-screen">

      <Header title="Live Monitor" />

      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
              Live — {scans.length} Scans geladen
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setIsPaused(!isPaused)}>
              {isPaused ? <Play className="h-4 w-4 mr-1" /> : <Pause className="h-4 w-4 mr-1" />}
              {isPaused ? "Fortsetzen" : "Pause"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setSoundEnabled(!soundEnabled)}>
              {soundEnabled ? <Volume2 className="h-4 w-4 mr-1" /> : <VolumeX className="h-4 w-4 mr-1" />}
              Sound
            </Button>
            <Button variant="outline" size="sm" onClick={toggleFullscreen}>
              {isFullscreen ? <Minimize className="h-4 w-4 mr-1" /> : <Maximize className="h-4 w-4 mr-1" />}
              {isFullscreen ? "Beenden" : "Vollbild"}
            </Button>
          </div>
        </div>

        {counts.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {counts.map((c) => (
              <Card key={c.areaId} className="border-slate-200 dark:border-slate-800">
                <CardContent className="p-4">
                  <p className="text-sm text-slate-500">Bereich {c.areaId}</p>
                  <p className="text-4xl font-bold text-slate-900 dark:text-white mt-1">{c.current}</p>
                  <div className="flex gap-4 mt-2 text-xs text-slate-400">
                    <span className="text-emerald-600">↑ {c.entries} rein</span>
                    <span className="text-rose-600">↓ {c.exits} raus</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          <Card className="lg:col-span-3 border-slate-200 dark:border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Scan-Feed</CardTitle>
            </CardHeader>
            <CardContent>
              <div ref={feedRef} className="space-y-2 max-h-[60vh] overflow-y-auto">
                {scans.length === 0 && (
                  <p className="text-center text-slate-500 py-12">Warte auf Scans...</p>
                )}
                {scans.map((scan) => {
                  const isNew = newIds.has(scan.id);
                  return (
                  <div
                    key={scan.id}
                    className={`flex items-center justify-between p-3 rounded-lg border transition-all ${
                      scan.result === "GRANTED"
                        ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-900/50"
                        : scan.result === "DENIED"
                          ? "bg-rose-50 border-rose-200 dark:bg-rose-950/20 dark:border-rose-900/50"
                          : "bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-900/50"
                    } ${isNew ? "animate-scan-flash ring-2 ring-offset-1" : ""} ${
                      isNew && scan.result === "GRANTED" ? "ring-emerald-400" :
                      isNew && scan.result === "DENIED" ? "ring-rose-400" :
                      isNew ? "ring-amber-400" : ""
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Badge
                        className={
                          scan.result === "GRANTED"
                            ? "bg-emerald-500 text-white"
                            : scan.result === "DENIED"
                              ? "bg-rose-500 text-white"
                              : "bg-amber-500 text-white"
                        }
                      >
                        {scan.result === "GRANTED" ? "✓" : scan.result === "DENIED" ? "✕" : "⚠"}
                      </Badge>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                          {scan.ticket?.name || scan.code}
                        </p>
                        <p className="text-xs text-slate-500 truncate">
                          {[scan.ticket?.firstName, scan.ticket?.lastName].filter(Boolean).join(" ") || scan.device.name}
                          {(scan.ticket?.firstName || scan.ticket?.lastName) ? ` · ${scan.device.name}` : ` · ${scan.code}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {scan.ticket?.validityType === "DURATION" && scan.ticket.validityDurationMinutes && scan.ticket.firstScanAt && (
                        <InternalCountdown
                          firstScanAt={scan.ticket.firstScanAt}
                          durationMinutes={scan.ticket.validityDurationMinutes}
                        />
                      )}
                      <span className="text-xs text-slate-400 font-mono">
                        {fmtTime(scan.scanTime)}
                      </span>
                    </div>
                  </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 dark:border-slate-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Geräte</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {devices.map((d) => {
                const isOnline = d.lastUpdate && d.lastUpdate > fiveMinAgo;
                return (
                  <div key={d.id} className="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-slate-900">
                    <div className="flex items-center gap-2">
                      <div className={`h-2 w-2 rounded-full ${isOnline ? "bg-emerald-500" : "bg-slate-400"}`} />
                      <span className="text-sm">{d.name}</span>
                    </div>
                    <span className="text-xs text-slate-400">{d.type === "SHELLY" ? "Shelly" : "Pi"}</span>
                  </div>
                );
              })}
              {devices.length === 0 && (
                <p className="text-sm text-slate-500 text-center py-4">Keine Geräte</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function InternalCountdown({ firstScanAt, durationMinutes }: { firstScanAt: string; durationMinutes: number }) {
  const [remaining, setRemaining] = useState("");
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const expiresAt = new Date(firstScanAt).getTime() + durationMinutes * 60_000;

    const tick = () => {
      const diff = expiresAt - Date.now();
      if (diff <= 0) {
        setRemaining("abgelaufen");
        setExpired(true);
        return;
      }
      const h = Math.floor(diff / 3_600_000);
      const m = Math.floor((diff % 3_600_000) / 60_000);
      const s = Math.floor((diff % 60_000) / 1_000);
      setRemaining(h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`);
      setExpired(false);
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [firstScanAt, durationMinutes]);

  return (
    <span className={`text-xs font-mono px-1.5 py-0.5 rounded tabular-nums ${
      expired
        ? "bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400"
        : "bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400"
    }`}>
      {remaining}
    </span>
  );
}
