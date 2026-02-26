"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { use } from "react";
import { Badge } from "@/components/ui/badge";
import { Shield, Wifi, WifiOff, CheckCircle2, XCircle, Clock, ScanLine } from "lucide-react";
import { cn, fmtTime, fmtDate } from "@/lib/utils";

interface Device {
  id: number;
  name: string;
  type: string;
  isActive: boolean;
  lastUpdate: string | null;
  task: number;
}

interface Scan {
  id: number;
  code: string;
  result: "GRANTED" | "DENIED" | "PROTECTED";
  scanTime: string;
  device: { id: number; name: string };
  ticket: { name: string } | null;
}

interface Stats {
  granted: number;
  denied: number;
  total: number;
}

interface Props {
  params: Promise<{ token: string }>;
}

export default function PublicMonitorPage({ params }: Props) {
  const { token } = use(params);
  const [monitorName, setMonitorName] = useState<string>("");
  const [devices, setDevices] = useState<Device[]>([]);
  const [scans, setScans] = useState<Scan[]>([]);
  const [newIds, setNewIds] = useState<Set<number>>(new Set());
  const [stats, setStats] = useState<Stats>({ granted: 0, denied: 0, total: 0 });
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const esRef = useRef<EventSource | null>(null);
  const isFirstLoad = useRef(true);

  useEffect(() => {
    function connect() {
      const es = new EventSource(`/api/monitor/public/${token}`);
      esRef.current = es;

      es.onopen = () => { setConnected(true); setError(""); };
      es.onerror = () => {
        setConnected(false);
        es.close();
        setTimeout(connect, 3000);
      };

      es.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === "meta") {
          setMonitorName(msg.data.name);
          setDevices(msg.data.devices);
        } else if (msg.type === "scans") {
          const incoming = msg.data as Scan[];
          setScans((prev) => {
            const existing = new Set(prev.map((s) => s.id));
            const fresh = incoming.filter((s) => !existing.has(s.id));
            if (!isFirstLoad.current && fresh.length > 0) {
              setNewIds(new Set(fresh.map((s) => s.id)));
              setTimeout(() => setNewIds(new Set()), 1500);
            }
            isFirstLoad.current = false;
            return [...fresh, ...prev].slice(0, 50);
          });
        } else if (msg.type === "stats") {
          setStats(msg.data);
        } else if (msg.type === "devices") {
          setDevices(msg.data);
        }
      };
    }

    connect();
    return () => { esRef.current?.close(); };
  }, [token]);

  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

  const resultStyle = {
    GRANTED: {
      bg: "bg-emerald-500/10 border-emerald-500/20",
      text: "text-emerald-400",
      badge: "bg-emerald-500/20 text-emerald-300",
      icon: CheckCircle2,
      label: "Erlaubt",
    },
    DENIED: {
      bg: "bg-rose-500/10 border-rose-500/20",
      text: "text-rose-400",
      badge: "bg-rose-500/20 text-rose-300",
      icon: XCircle,
      label: "Abgelehnt",
    },
    PROTECTED: {
      bg: "bg-amber-500/10 border-amber-500/20",
      text: "text-amber-400",
      badge: "bg-amber-500/20 text-amber-300",
      icon: Clock,
      label: "Geschützt",
    },
  } as const;

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <p className="text-rose-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Header */}
      <header className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-indigo-600 flex items-center justify-center">
            <Shield className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">{monitorName || "Live Monitor"}</h1>
            <p className="text-xs text-slate-400">EMP Access — Echtzeit-Zugangsmonitor</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {connected ? (
            <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live
            </Badge>
          ) : (
            <Badge className="bg-slate-700 text-slate-400 gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-slate-500" />
              Verbinde…
            </Badge>
          )}
        </div>
      </header>

      <div className="flex-1 p-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Scans heute", value: stats.total, color: "text-slate-200", bg: "bg-slate-800" },
            { label: "Erlaubt", value: stats.granted, color: "text-emerald-400", bg: "bg-emerald-500/10" },
            { label: "Abgelehnt", value: stats.denied, color: "text-rose-400", bg: "bg-rose-500/10" },
          ].map((s) => (
            <div key={s.label} className={cn("rounded-xl border border-slate-700/50 p-5 text-center", s.bg)}>
              <p className={cn("text-4xl font-bold tabular-nums", s.color)}>{s.value}</p>
              <p className="text-sm text-slate-400 mt-1">{s.label}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Scans Feed */}
          <div className="lg:col-span-2 space-y-2">
            <div className="flex items-center gap-2 mb-3">
              <ScanLine className="h-4 w-4 text-slate-400" />
              <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider">Letzte Scans</h2>
            </div>
            {scans.length === 0 && (
              <div className="rounded-xl border border-slate-800 p-10 text-center text-slate-500">
                Warte auf Scans…
              </div>
            )}
            <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
              {scans.map((scan) => {
                const style = resultStyle[scan.result];
                const Icon = style.icon;
                const isNew = newIds.has(scan.id);
                return (
                  <div
                    key={scan.id}
                    className={cn(
                      "flex items-center justify-between rounded-xl border px-4 py-3 transition-all",
                      style.bg,
                      isNew && "animate-scan-flash ring-2 ring-offset-1 ring-offset-slate-950",
                      isNew && scan.result === "GRANTED" && "ring-emerald-400",
                      isNew && scan.result === "DENIED" && "ring-rose-400",
                      isNew && scan.result === "PROTECTED" && "ring-amber-400",
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <Icon className={cn("h-5 w-5 shrink-0", style.text)} />
                      <div>
                        <p className="font-medium text-slate-100 text-sm">
                          {scan.ticket?.name || scan.code}
                        </p>
                        <p className="text-xs text-slate-400">{scan.device.name}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className={cn("text-xs px-2 py-0.5 rounded-full", style.badge)}>
                        {style.label}
                      </span>
                      <span className="text-xs text-slate-500 tabular-nums">
                        {fmtTime(scan.scanTime)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Devices */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Wifi className="h-4 w-4 text-slate-400" />
              <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider">Geräte</h2>
            </div>
            <div className="space-y-2">
              {devices.map((device) => {
                const online = device.lastUpdate
                  ? new Date(device.lastUpdate) > fiveMinAgo
                  : false;
                return (
                  <div
                    key={device.id}
                    className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900 px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "h-2 w-2 rounded-full shrink-0",
                        online ? "bg-emerald-400 shadow-[0_0_8px_2px_rgba(52,211,153,0.4)]" : "bg-slate-600"
                      )} />
                      <div>
                        <p className="text-sm font-medium text-slate-200">{device.name}</p>
                        <p className="text-xs text-slate-500">
                          {device.type === "RASPBERRY_PI" ? "Raspberry Pi" : "Shelly"}
                        </p>
                      </div>
                    </div>
                    {online ? (
                      <Wifi className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <WifiOff className="h-4 w-4 text-slate-600" />
                    )}
                  </div>
                );
              })}
              {devices.length === 0 && (
                <p className="text-sm text-slate-500 text-center py-4">Keine Geräte</p>
              )}
            </div>

            {/* Clock */}
            <LiveClock />
          </div>
        </div>
      </div>
    </div>
  );
}

function LiveClock() {
  const [time, setTime] = useState("");
  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString("de-DE"));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="mt-4 rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-center">
      <p className="text-3xl font-mono font-bold text-slate-200">{time}</p>
      <p className="text-xs text-slate-500 mt-1">{new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" })}</p>
    </div>
  );
}
