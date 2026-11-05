"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useWakeLock } from "@/hooks/use-wake-lock";
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
import { EmptyState } from "@/components/ui/empty-state";
import { IconChip } from "@/components/ui/icon-chip";
import { StatCard } from "@/components/ui/stat-card";
import { StatusDot } from "@/components/ui/status-dot";
import { Check, ChevronDown, DoorOpen, Loader2, MapPin, Maximize, Minimize, Pause, Play, ScanLine, ShieldAlert, Ticket, Users, Volume2, VolumeX, Wifi, X } from "lucide-react";
import { fmtTime } from "@/lib/utils";
import { berlinYmd, isSameBerlinDay } from "@/lib/berlin-day";
import { parseScanDisplayNote, scanDenyReasonLabel } from "@/lib/scan-deny-reason";

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

/** Poll-Takt des Leitstands. */
const MONITOR_POLL_MS = 5000;

export default function MonitorPage() {
  const [scans, setScans] = useState<MonitorScan[]>([]);
  const [newIds, setNewIds] = useState<Set<number>>(new Set());
  const [counts, setCounts] = useState<AreaCount[]>([]);
  const [devices, setDevices] = useState<DeviceStatus[]>([]);
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<number[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  // Bildschirm wach halten, solange die Seite sichtbar ist.
  useWakeLock(true);
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

    // Kurzes Polling statt SSE: ein Event-Stream hielt pro Tab eine
    // Function-Instanz dauerhaft offen (siehe /api/monitor).
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let since = 0;
    const devicesParam = selectedDeviceIds.length > 0 ? selectedDeviceIds.join(",") : "";

    async function poll() {
      try {
        const res = await fetch(`/api/monitor?since=${since}&areas=&devices=${devicesParam}`, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const msg = (await res.json()) as {
          scans: MonitorScan[];
          counts: AreaCount[] | null;
          devices: DeviceStatus[];
          lastScanId: number;
        };
        if (cancelled) return;

        if (msg.scans.length > 0) {
          const incoming = msg.scans.filter((s) => isSameBerlinDay(s.scanTime));
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
        } else {
          isFirstLoad.current = false;
        }
        if (typeof msg.lastScanId === "number") since = msg.lastScanId;
        if (msg.counts) setCounts(msg.counts);
        if (msg.devices) setDevices(msg.devices);
      } catch {
        /* Netzwerkfehler still ignorieren – der naechste Poll kommt. */
      }
    }

    function start() {
      if (timer) return;
      void poll();
      timer = setInterval(() => void poll(), MONITOR_POLL_MS);
    }
    function stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }

    start();

    const handleVisibility = () => {
      if (document.hidden) stop();
      else start();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      stop();
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
    // Kein eigener Hintergrund; nur im Vollbild trägt der Container den Seitengrund selbst.
    <div ref={containerRef} className="min-h-[100dvh] [&:fullscreen]:page-ambient">

      <Header title="Live-Monitor" />

      <div className="page-content space-y-4 sm:space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            {/* Pulsieren nur, solange der Feed lebt; Pause in der Hinweisfarbe (docs/design-regeln.md, Abschnitte 3 und 9). */}
            <StatusDot tone={isPaused ? "warning" : "success"} pulse={!isPaused} size="md" />
            <span className="text-sm font-medium text-muted-foreground tabular-nums">
              Live — {scans.length} Scans geladen
            </span>
          </div>
          {/* Handy: vier Tasten als 2×2-Raster statt einer einzelnen umbrechenden Taste; ab sm eine Zeile. */}
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="font-normal max-sm:h-11">
                  {selectedDeviceIds.length === 0
                    ? "Alle Geräte"
                    : `${selectedDeviceIds.length} Gerät${selectedDeviceIds.length !== 1 ? "e" : ""}`}
                  <ChevronDown className="h-4 w-4 opacity-50 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              {/* Breit genug für ganze Gerätenamen („Drehkreuz Strandbad Eingang“/„… Ausgang“ wären sonst gleich gekürzt). */}
              <DropdownMenuContent align="end" className="w-72 max-w-[calc(100vw-2rem)] max-h-72 overflow-y-auto">
                <DropdownMenuLabel className="text-xs text-muted-foreground">Feed nach Gerät filtern</DropdownMenuLabel>
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
                        <StatusDot tone={d.lastUpdate && d.lastUpdate > fiveMinAgo ? "success" : "neutral"} />
                        {d.name}
                      </span>
                      <span className="ml-auto text-xs text-muted-foreground/70">{d.type === "SHELLY" ? "Shelly" : "Pi"}</span>
                    </DropdownMenuCheckboxItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" size="sm" className="max-sm:h-11" onClick={() => setIsPaused(!isPaused)}>
              {isPaused ? <Play className="h-4 w-4 mr-1" /> : <Pause className="h-4 w-4 mr-1" />}
              {isPaused ? "Fortsetzen" : "Pause"}
            </Button>
            <Button variant="outline" size="sm" className="max-sm:h-11" onClick={() => setSoundEnabled(!soundEnabled)}>
              {soundEnabled ? <Volume2 className="h-4 w-4 mr-1" /> : <VolumeX className="h-4 w-4 mr-1" />}
              Sound
            </Button>
            <Button variant="outline" size="sm" className="max-sm:h-11" onClick={toggleFullscreen}>
              {isFullscreen ? <Minimize className="h-4 w-4 mr-1" /> : <Maximize className="h-4 w-4 mr-1" />}
              {isFullscreen ? "Beenden" : "Vollbild"}
            </Button>
          </div>
        </div>

        {/* Belegung je Resource als Kennzahl-Kacheln (docs/design-regeln.md, Abschnitt 8). Eine Spalte auf dem Handy und vier erst ab xl, damit „rein · raus“ ungekürzt in die Kachel passt. */}
        {counts.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
            {counts.map((c) => (
              <StatCard
                key={c.areaId}
                label={`Resource ${c.areaId}`}
                value={c.current}
                icon={Users}
                hint={`↑ ${c.entries} rein · ↓ ${c.exits} raus`}
              />
            ))}
          </div>
        )}

        {(() => {
          const openable = devices.filter((d) => d.category && OPENABLE_CATEGORIES.has(d.category));
          if (openable.length === 0) return null;
          return (
            <Card>
              <CardHeader>
                <CardTitle>Schnell-Öffnen</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {openable.map((d) => {
                    const isLoading = openingId === d.id;
                    const wasOpened = openedIds.has(d.id);
                    const online = d.lastUpdate && d.lastUpdate > fiveMinAgo;
                    return (
                      // max-w-full und truncate: Lange Gerätenamen kürzen in der Karte, statt die Seite auf
                      // dem Handy seitlich zu verbreitern (docs/design-regeln.md, Abschnitt 5).
                      <Button
                        key={d.id}
                        size="sm"
                        variant="outline"
                        disabled={openingId !== null}
                        onClick={() => handleQuickOpen(d.id)}
                        className={`gap-1.5 max-w-full max-sm:h-11 ${
                          wasOpened
                            ? "bg-success hover:bg-success/90 text-success-foreground border-success"
                            : "hover:bg-success/10 "
                        }`}
                      >
                        {isLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : wasOpened ? (
                          <Check className="h-4 w-4" />
                        ) : (
                          <DoorOpen className="h-4 w-4" />
                        )}
                        <span className="flex min-w-0 items-center gap-1.5">
                          <StatusDot size="xs" tone={online ? "success" : "neutral"} />
                          <span className="truncate">{d.name}</span>
                        </span>
                      </Button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          );
        })()}

        <Card>
          <CardHeader>
            <CardTitle>Scan-Feed</CardTitle>
          </CardHeader>
          <CardContent>
            <div ref={feedRef} className="space-y-2 max-h-[60vh] overflow-y-auto scrollbar-thin">
              {scans.length === 0 && (
                <EmptyState compact icon={ScanLine} title="Warte auf Scans..." />
              )}
              {scans.map((scan) => {
                const isNew = newIds.has(scan.id);
                const noteData = parseScanDisplayNote(scan.note);
                const denyReason = scan.result !== "GRANTED" ? scanDenyReasonLabel(scan.note) : null;
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
                  className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-2 p-3 rounded-tile border transition-all ${
                    scan.result === "GRANTED"
                      ? "bg-success/10 border-success/30 "
                      : scan.result === "DENIED"
                        ? "bg-destructive/10 border-destructive/30 "
                        : "bg-warning/10 border-warning/30 "
                  } ${isNew ? "animate-scan-flash ring-2 ring-offset-1 ring-offset-background" : ""} ${
                    isNew && scan.result === "GRANTED" ? "ring-success" :
                    isNew && scan.result === "DENIED" ? "ring-destructive" :
                    isNew ? "ring-warning" : ""
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {displayImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={displayImage} alt="" className="h-14 w-14 rounded-full object-cover shrink-0 ring-2 ring-glass-border" />
                    ) : (
                      // Ergebnis als Symbol-Chip in der Zustandsfarbe, so groß wie ein Foto, damit die Zeilen fluchten.
                      <IconChip
                        icon={scan.result === "GRANTED" ? Check : scan.result === "DENIED" ? X : ShieldAlert}
                        tone={scan.result === "GRANTED" ? "success" : scan.result === "DENIED" ? "danger" : "warning"}
                        active
                        size="lg"
                        label={scan.result === "GRANTED" ? "Erlaubt" : scan.result === "DENIED" ? "Abgelehnt" : "Geschützt"}
                        className="size-14 rounded-full"
                      />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {displayName}
                        {noteData.age != null && (
                          <span className="ml-1.5 text-xs font-normal text-muted-foreground">({noteData.age})</span>
                        )}
                      </p>
                      {denyReason && (
                        <p className="text-xs font-semibold text-destructive truncate">
                          {denyReason}
                        </p>
                      )}
                      {/* Handy: ohne Trennpunkte – die Zeile bricht dort um, ein Punkt bliebe am Zeilenende
                          stehen; jedes Teil hat sein Symbol. */}
                      <p className="text-xs text-muted-foreground truncate flex items-center gap-1.5 max-sm:gap-x-2.5 flex-wrap">
                        {scan.ticket?.ticketTypeName && (
                          <span className="inline-flex items-center gap-1 shrink-0">
                            <Ticket className="h-3 w-3 text-muted-foreground/70 shrink-0" aria-hidden />
                            <span className="truncate">{scan.ticket.ticketTypeName}</span>
                          </span>
                        )}
                        {scan.ticket?.ticketTypeName && scan.ticket?.accessArea?.name && (
                          <span className="text-muted-foreground/70 shrink-0 max-sm:hidden">·</span>
                        )}
                        {scan.ticket?.accessArea?.name && (
                          <span className="inline-flex items-center gap-1 shrink-0 min-w-0">
                            <MapPin className="h-3 w-3 text-muted-foreground/70 shrink-0" aria-hidden />
                            <span className="truncate">{scan.ticket.accessArea.name}</span>
                          </span>
                        )}
                        {(scan.ticket?.ticketTypeName || scan.ticket?.accessArea?.name) && scan.device?.name && (
                          <span className="text-muted-foreground/70 shrink-0 max-sm:hidden">·</span>
                        )}
                        {scan.device?.name && (
                          <span className="inline-flex items-center gap-1 shrink-0 min-w-0">
                            <Wifi className="h-3 w-3 text-muted-foreground/70 shrink-0" aria-hidden />
                            <span className="truncate">{scan.device.name}</span>
                          </span>
                        )}
                        {isWakesys && (
                          <>
                            {scan.device?.name && <span className="text-muted-foreground/70 shrink-0 max-sm:hidden">·</span>}
                            <span className="inline-flex items-center gap-1 shrink-0 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                              {scan.code}
                            </span>
                          </>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="ml-auto flex items-center gap-2 shrink-0">
                    {isWakesys && (
                      <Badge
                        variant="warning"
                        className="text-[11px] uppercase tracking-wider border-warning/30"
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
                    <span className="text-xs text-muted-foreground font-mono">
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

  // Restzeit als Status-Pille: laufend Info, abgelaufen Störung (docs/design-regeln.md, Abschnitt 3).
  return (
    <Badge variant={expired ? "danger" : "info"} className="font-mono font-medium tabular-nums">
      {remaining}
    </Badge>
  );
}
