"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Header } from "@/components/layout/header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Check, ChevronDown, DoorOpen, Loader2, MapPin, Maximize, Minimize, Pause, Play, Ticket, Volume2, VolumeX, Wifi } from "lucide-react";
import { fmtTime } from "@/lib/utils";
import { berlinYmd, isSameBerlinDay } from "@/lib/berlin-day";

interface MonitorScan {
  id: number;
  code: string;
  note?: string | null;
  scanTime: string;
  result: "GRANTED" | "DENIED" | "PROTECTED";
  device: { name: string; type: string };
  ticket?: {
    name: string;
    firstName?: string | null;
    lastName?: string | null;
    ticketTypeName?: string | null;
    validityType?: string;
    validityDurationMinutes?: number | null;
    firstScanAt?: string | null;
    profileImage?: string | null;
    accessArea?: { name: string } | null;
  } | null;
}

/**
 * Wakesys-Scans haben kein lokales Ticket, sondern eine `note` mit JSON aus
 * `checkWakesys` (siehe src/lib/wakesys.ts): { name, picture, age }. Plain-Text-
 * Notes werden als Name interpretiert (Fallback fuer aeltere Eintraege).
 */
function parseScanNote(note?: string | null): { name?: string; picture?: string; age?: number } {
  if (!note) return {};
  try {
    const parsed = JSON.parse(note);
    if (typeof parsed === "object" && parsed !== null) return parsed;
  } catch {
    return { name: note };
  }
  return {};
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
  category: "DREHKREUZ" | "TUER" | "SENSOR" | "SCHALTER" | "BELEUCHTUNG" | null;
  isActive: boolean;
  lastUpdate: string | null;
  task: number;
}

const OPENABLE_CATEGORIES = new Set(["DREHKREUZ", "TUER"]);

export default function MonitorPage() {
  const [scans, setScans] = useState<MonitorScan[]>([]);
  const [newIds, setNewIds] = useState<Set<number>>(new Set());
  const [counts, setCounts] = useState<AreaCount[]>([]);
  const [devices, setDevices] = useState<DeviceStatus[]>([]);
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<number[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [dayKey, setDayKey] = useState(() => berlinYmd(new Date()));
  const [openingId, setOpeningId] = useState<number | null>(null);
  const [openedIds, setOpenedIds] = useState<Set<number>>(new Set());
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

  const handleQuickOpen = useCallback(async (deviceId: number) => {
    setOpeningId(deviceId);
    try {
      const res = await fetch(`/api/devices/${deviceId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "open" }),
      });
      if (res.ok) {
        setOpenedIds((prev) => new Set(prev).add(deviceId));
        setTimeout(() => {
          setOpenedIds((prev) => {
            const next = new Set(prev);
            next.delete(deviceId);
            return next;
          });
        }, 2000);
      }
    } finally {
      setOpeningId(null);
    }
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

    let es: EventSource | null = null;

    function connectSSE() {
      const devicesParam = selectedDeviceIds.length > 0 ? selectedDeviceIds.join(",") : "";
      es = new EventSource(`/api/monitor?areas=&devices=${devicesParam}`);

      es.onmessage = (event) => {
        const msg = JSON.parse(event.data);

        if (msg.type === "scans" && msg.data.length > 0) {
          const incoming = (msg.data as MonitorScan[]).filter((s) => isSameBerlinDay(s.scanTime));
          setScans((prev) => {
            const todayPrev = prev.filter((s) => isSameBerlinDay(s.scanTime));
            const existing = new Set(todayPrev.map((s) => s.id));
            const fresh = incoming.filter((s) => !existing.has(s.id));
            if (!isFirstLoad.current && fresh.length > 0) {
              setNewIds(new Set(fresh.map((s) => s.id)));
              setTimeout(() => setNewIds(new Set()), 1500);
            }
            isFirstLoad.current = false;
            return [...fresh, ...todayPrev].slice(0, 100);
          });

          if (soundEnabled && incoming.some((s) => s.result === "DENIED")) {
            playAlertSound();
          }
        }
        if (msg.type === "counts") setCounts(msg.data);
        if (msg.type === "devices") setDevices(msg.data);
      };
    }

    connectSSE();

    const handleVisibility = () => {
      if (document.hidden) {
        es?.close();
        es = null;
      } else if (!es) {
        connectSSE();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      es?.close();
    };
  }, [isPaused, soundEnabled, playAlertSound, selectedDeviceIds, dayKey]);

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = 0;
    }
  }, [scans]);

  useEffect(() => {
    const id = setInterval(() => {
      const nowDay = berlinYmd(new Date());
      setDayKey((prev) => {
        if (prev !== nowDay) {
          setScans([]);
          isFirstLoad.current = true;
          return nowDay;
        }
        return prev;
      });
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  return (
    <div ref={containerRef} className="bg-slate-50 dark:bg-slate-950 min-h-screen">

      <Header title="Live Monitor" />

      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
              Live — {scans.length} Scans geladen
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="font-normal">
                  {selectedDeviceIds.length === 0
                    ? "Alle Geräte"
                    : `${selectedDeviceIds.length} Gerät${selectedDeviceIds.length !== 1 ? "e" : ""}`}
                  <ChevronDown className="h-4 w-4 opacity-50 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 max-h-72 overflow-y-auto">
                <DropdownMenuLabel className="text-xs text-slate-500">Feed nach Gerät filtern</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem
                  checked={selectedDeviceIds.length === 0}
                  onCheckedChange={() => setSelectedDeviceIds([])}
                >
                  Alle Geräte
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                {devices.map((d) => {
                  const checked = selectedDeviceIds.length === 0 || selectedDeviceIds.includes(d.id);
                  return (
                    <DropdownMenuCheckboxItem
                      key={d.id}
                      checked={checked}
                      onCheckedChange={(isChecked) => {
                        if (isChecked) {
                          setSelectedDeviceIds((prev) =>
                            prev.length === 0 ? [d.id] : prev.includes(d.id) ? prev : [...prev, d.id]
                          );
                        } else {
                          setSelectedDeviceIds((prev) =>
                            prev.length === 0
                              ? devices.filter((x) => x.id !== d.id).map((x) => x.id)
                              : prev.filter((id) => id !== d.id)
                          );
                        }
                      }}
                    >
                      <span className="flex items-center gap-2 truncate">
                        <span className={`h-2 w-2 rounded-full shrink-0 ${d.lastUpdate && d.lastUpdate > fiveMinAgo ? "bg-emerald-500" : "bg-slate-400"}`} />
                        {d.name}
                      </span>
                      <span className="ml-auto text-xs text-slate-400">{d.type === "SHELLY" ? "Shelly" : "Pi"}</span>
                    </DropdownMenuCheckboxItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
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
                  <p className="text-sm text-slate-500">Resource {c.areaId}</p>
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

        {(() => {
          const openable = devices.filter((d) => d.category && OPENABLE_CATEGORIES.has(d.category));
          if (openable.length === 0) return null;
          return (
            <Card className="border-slate-200 dark:border-slate-800">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Schnell-Öffnen</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {openable.map((d) => {
                    const isLoading = openingId === d.id;
                    const wasOpened = openedIds.has(d.id);
                    const online = d.lastUpdate && d.lastUpdate > fiveMinAgo;
                    return (
                      <Button
                        key={d.id}
                        size="sm"
                        variant="outline"
                        disabled={openingId !== null}
                        onClick={() => handleQuickOpen(d.id)}
                        className={`gap-1.5 ${
                          wasOpened
                            ? "bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600"
                            : "hover:bg-emerald-50 dark:hover:bg-emerald-950/20"
                        }`}
                      >
                        {isLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : wasOpened ? (
                          <Check className="h-4 w-4" />
                        ) : (
                          <DoorOpen className="h-4 w-4" />
                        )}
                        <span className="flex items-center gap-1.5">
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              online ? "bg-emerald-500" : "bg-slate-400"
                            }`}
                          />
                          {d.name}
                        </span>
                      </Button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          );
        })()}

        <Card className="border-slate-200 dark:border-slate-800">
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
                const noteData = parseScanNote(scan.note);
                // Wakesys-Treffer: GRANTED-Scan ohne lokales Ticket, dafuer aber
                // angereicherte Note vom Wakesys-Fallback (siehe pi/scan/route.ts).
                const isWakesys = !scan.ticket && scan.result === "GRANTED" && !!scan.note;
                const displayImage = scan.ticket?.profileImage || noteData.picture || null;
                const displayName =
                  [scan.ticket?.firstName, scan.ticket?.lastName].filter(Boolean).join(" ")
                  || scan.ticket?.name
                  || noteData.name
                  || scan.code;
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
                    {displayImage ? (
                      <img src={displayImage} alt="" className="h-14 w-14 rounded-full object-cover shrink-0 ring-2 ring-slate-200 dark:ring-slate-700" />
                    ) : (
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
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                        {displayName}
                        {noteData.age != null && (
                          <span className="ml-1.5 text-xs font-normal text-slate-400">({noteData.age})</span>
                        )}
                      </p>
                      <p className="text-xs text-slate-500 truncate flex items-center gap-1.5 flex-wrap">
                        {scan.ticket?.ticketTypeName && (
                          <span className="inline-flex items-center gap-1 shrink-0">
                            <Ticket className="h-3 w-3 text-slate-400 shrink-0" aria-hidden />
                            <span className="truncate">{scan.ticket.ticketTypeName}</span>
                          </span>
                        )}
                        {scan.ticket?.ticketTypeName && scan.ticket?.accessArea?.name && (
                          <span className="text-slate-400 shrink-0">·</span>
                        )}
                        {scan.ticket?.accessArea?.name && (
                          <span className="inline-flex items-center gap-1 shrink-0 min-w-0">
                            <MapPin className="h-3 w-3 text-slate-400 shrink-0" aria-hidden />
                            <span className="truncate">{scan.ticket.accessArea.name}</span>
                          </span>
                        )}
                        {(scan.ticket?.ticketTypeName || scan.ticket?.accessArea?.name) && scan.device?.name && (
                          <span className="text-slate-400 shrink-0">·</span>
                        )}
                        {scan.device?.name && (
                          <span className="inline-flex items-center gap-1 shrink-0 min-w-0">
                            <Wifi className="h-3 w-3 text-slate-400 shrink-0" aria-hidden />
                            <span className="truncate">{scan.device.name}</span>
                          </span>
                        )}
                        {isWakesys && (
                          <>
                            {scan.device?.name && <span className="text-slate-400 shrink-0">·</span>}
                            <span className="inline-flex items-center gap-1 shrink-0 font-mono text-[10px] uppercase tracking-wider text-slate-400">
                              {scan.code}
                            </span>
                          </>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {isWakesys && (
                      <Badge
                        variant="outline"
                        className="text-[10px] font-bold uppercase tracking-wider border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700/50 dark:bg-amber-900/30 dark:text-amber-300"
                      >
                        Wakesys
                      </Badge>
                    )}
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
      </div>
    </div>
  );
}

function formatExpiredSince(expiredForMs: number): string {
  const secs = Math.max(0, Math.floor(expiredForMs / 1000));
  if (secs < 60) return `abgelaufen seit ${secs} Sek.`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `abgelaufen seit ${mins} Min.`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    const m = mins % 60;
    return m > 0 ? `abgelaufen seit ${hours} Std. ${m} Min.` : `abgelaufen seit ${hours} Std.`;
  }
  const days = Math.floor(hours / 24);
  return days === 1 ? "abgelaufen seit 1 Tag" : `abgelaufen seit ${days} Tagen`;
}

function InternalCountdown({ firstScanAt, durationMinutes }: { firstScanAt: string; durationMinutes: number }) {
  const [remaining, setRemaining] = useState("");
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const expiresAt = new Date(firstScanAt).getTime() + durationMinutes * 60_000;

    const tick = () => {
      const diff = expiresAt - Date.now();
      if (diff <= 0) {
        setRemaining(formatExpiredSince(-diff));
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
