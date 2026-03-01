"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Html5Qrcode, Html5QrcodeScannerState } from "html5-qrcode";
import {
  Camera,
  SwitchCamera,
  CheckCircle2,
  XCircle,
  Loader2,
  QrCode,
  Clock,
  User,
  MapPin,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

function playTone(granted: boolean) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);

    if (granted) {
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(1320, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.35);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.35);
    } else {
      osc.type = "square";
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(220, ctx.currentTime + 0.2);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.4);
    }

    osc.onended = () => ctx.close();
  } catch {
    /* AudioContext not available */
  }
}

interface ScanResult {
  id: string;
  code: string;
  granted: boolean;
  message: string;
  ticket?: {
    name: string;
    firstName: string | null;
    lastName: string | null;
    ticketTypeName: string | null;
    status: string;
    areaName: string | null;
    serviceName: string | null;
    subscriptionName: string | null;
  };
  time: Date;
}

interface AccessArea {
  id: number;
  name: string;
}

export function ScannerClient() {
  const [isScanning, setIsScanning] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [lastResult, setLastResult] = useState<ScanResult | null>(null);
  const [scanHistory, setScanHistory] = useState<ScanResult[]>([]);
  const [areas, setAreas] = useState<AccessArea[]>([]);
  const [selectedArea, setSelectedArea] = useState<string>("all");
  const [error, setError] = useState<string | null>(null);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerRunningRef = useRef(false);
  const cooldownRef = useRef<string | null>(null);
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    fetch("/api/areas")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setAreas(data);
      })
      .catch(() => {});
  }, []);

  const checkCode = useCallback(
    async (code: string) => {
      if (cooldownRef.current === code) return;
      cooldownRef.current = code;

      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
      cooldownTimerRef.current = setTimeout(() => {
        cooldownRef.current = null;
      }, 3000);

      try {
        const res = await fetch("/api/scan-check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code,
            accessAreaId: selectedArea !== "all" ? selectedArea : undefined,
          }),
        });
        const data = await res.json();

        const result: ScanResult = {
          id: crypto.randomUUID(),
          code,
          granted: data.granted,
          message: data.message,
          ticket: data.ticket,
          time: new Date(),
        };

        setLastResult(result);
        setScanHistory((prev) => [result, ...prev].slice(0, 50));
        playTone(data.granted);

        if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
        resultTimerRef.current = setTimeout(() => {
          if (mountedRef.current) setLastResult(null);
        }, 4000);
      } catch {
        setLastResult({
          id: crypto.randomUUID(),
          code,
          granted: false,
          message: "Netzwerkfehler",
          time: new Date(),
        });
        playTone(false);
      }
    },
    [selectedArea]
  );

  const stopScannerSafe = useCallback(async () => {
    if (scannerRef.current) {
      try {
        const state = scannerRef.current.getState();
        if (state === Html5QrcodeScannerState.SCANNING || state === Html5QrcodeScannerState.PAUSED) {
          await scannerRef.current.stop();
        }
      } catch {
        /* already stopped */
      }
      scannerRunningRef.current = false;
      try {
        scannerRef.current.clear();
      } catch {
        /* ignore */
      }
      scannerRef.current = null;
    }
    setIsScanning(false);
  }, []);

  const startScanner = useCallback(async () => {
    setError(null);
    setIsStarting(true);

    try {
      await stopScannerSafe();

      const scanner = new Html5Qrcode("scanner-viewport");
      scannerRef.current = scanner;

      const qrboxFn = (vw: number, vh: number) => {
        const size = Math.min(vw, vh) * 0.7;
        return { width: Math.floor(size), height: Math.floor(size) };
      };

      await scanner.start(
        { facingMode },
        {
          fps: 15,
          qrbox: qrboxFn,
        },
        (decodedText) => {
          checkCode(decodedText);
        },
        () => {}
      );

      scannerRunningRef.current = true;
      setIsScanning(true);
    } catch (err) {
      scannerRunningRef.current = false;
      const msg = err instanceof Error ? err.message : "Kamera-Zugriff fehlgeschlagen";
      setError(msg);
    } finally {
      setIsStarting(false);
    }
  }, [facingMode, checkCode, stopScannerSafe]);

  const toggleCamera = useCallback(async () => {
    const newMode = facingMode === "environment" ? "user" : "environment";
    setFacingMode(newMode);
    if (isScanning) {
      await stopScannerSafe();
    }
  }, [facingMode, isScanning, stopScannerSafe]);

  useEffect(() => {
    mountedRef.current = true;
    startScanner();

    return () => {
      mountedRef.current = false;
      if (scannerRef.current) {
        try {
          const state = scannerRef.current.getState();
          if (state === Html5QrcodeScannerState.SCANNING || state === Html5QrcodeScannerState.PAUSED) {
            scannerRef.current.stop().catch(() => {});
          }
        } catch { /* ignore */ }
        scannerRunningRef.current = false;
        try { scannerRef.current.clear(); } catch { /* ignore */ }
        scannerRef.current = null;
      }
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
      if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facingMode]);

  return (
    <div className="flex flex-col h-[calc(100dvh-3.5rem)] bg-slate-950">
      {/* Toolbar */}
      <div className="flex items-center justify-between p-3 bg-slate-900 border-b border-slate-800 gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <QrCode className="h-5 w-5 text-indigo-400 shrink-0" />
          <span className="text-sm font-medium text-white truncate">Live Scanner</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {areas.length > 0 && (
            <Select value={selectedArea} onValueChange={setSelectedArea}>
              <SelectTrigger className="h-9 w-[140px] sm:w-[180px] bg-slate-800 border-slate-700 text-slate-200 text-xs">
                <SelectValue placeholder="Bereich" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Bereiche</SelectItem>
                {areas.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleCamera}
            className="h-9 w-9 text-slate-400 hover:text-white hover:bg-slate-800"
            title="Kamera wechseln"
          >
            <SwitchCamera className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={isScanning ? stopScannerSafe : startScanner}
            className={cn(
              "h-9 w-9",
              isScanning
                ? "text-red-400 hover:text-red-300 hover:bg-slate-800"
                : "text-green-400 hover:text-green-300 hover:bg-slate-800"
            )}
            title={isScanning ? "Scanner stoppen" : "Scanner starten"}
          >
            <Camera className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Camera viewport + result overlay */}
      <div className="relative flex-1 flex items-center justify-center bg-black overflow-hidden">
        <div id="scanner-viewport" className="w-full h-full" />

        {isStarting && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-10">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-8 w-8 text-indigo-400 animate-spin" />
              <p className="text-sm text-slate-400">Kamera wird gestartet...</p>
            </div>
          </div>
        )}

        {error && !isScanning && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-10">
            <div className="flex flex-col items-center gap-4 p-6 max-w-sm text-center">
              <XCircle className="h-12 w-12 text-red-400" />
              <p className="text-sm text-slate-300">{error}</p>
              <Button onClick={startScanner} variant="outline" className="border-slate-700 text-slate-200">
                Erneut versuchen
              </Button>
            </div>
          </div>
        )}

        {/* Scan result banner */}
        {lastResult && (
          <div
            className={cn(
              "absolute top-0 left-0 right-0 z-20 transition-all duration-300 animate-in slide-in-from-top",
              lastResult.granted
                ? "bg-emerald-600/95 backdrop-blur-sm"
                : "bg-red-600/95 backdrop-blur-sm"
            )}
          >
            <div className="p-4">
              <div className="flex items-center gap-3">
                {lastResult.granted ? (
                  <CheckCircle2 className="h-8 w-8 text-white shrink-0" />
                ) : (
                  <XCircle className="h-8 w-8 text-white shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-white font-semibold text-lg">{lastResult.message}</p>
                  {lastResult.ticket && (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1">
                      {(lastResult.ticket.firstName || lastResult.ticket.lastName) && (
                        <span className="flex items-center gap-1 text-white/90 text-sm">
                          <User className="h-3.5 w-3.5" />
                          {[lastResult.ticket.firstName, lastResult.ticket.lastName]
                            .filter(Boolean)
                            .join(" ")}
                        </span>
                      )}
                      {lastResult.ticket.ticketTypeName && (
                        <span className="text-white/80 text-sm">
                          {lastResult.ticket.ticketTypeName}
                        </span>
                      )}
                      {(lastResult.ticket.serviceName || lastResult.ticket.subscriptionName) && (
                        <span className="text-white/80 text-sm">
                          {lastResult.ticket.subscriptionName || lastResult.ticket.serviceName}
                        </span>
                      )}
                      {lastResult.ticket.areaName && (
                        <span className="flex items-center gap-1 text-white/80 text-sm">
                          <MapPin className="h-3.5 w-3.5" />
                          {lastResult.ticket.areaName}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Scan frame overlay when scanning but no result shown */}
        {isScanning && !lastResult && !isStarting && (
          <div className="absolute inset-0 pointer-events-none z-10 flex items-center justify-center">
            <div className="w-[70vmin] h-[70vmin] max-w-[350px] max-h-[350px] relative">
              <div className="absolute top-0 left-0 w-10 h-10 border-t-3 border-l-3 border-indigo-400 rounded-tl-xl" />
              <div className="absolute top-0 right-0 w-10 h-10 border-t-3 border-r-3 border-indigo-400 rounded-tr-xl" />
              <div className="absolute bottom-0 left-0 w-10 h-10 border-b-3 border-l-3 border-indigo-400 rounded-bl-xl" />
              <div className="absolute bottom-0 right-0 w-10 h-10 border-b-3 border-r-3 border-indigo-400 rounded-br-xl" />
              <div className="absolute top-1/2 left-2 right-2 h-0.5 bg-indigo-400/50 animate-pulse" />
            </div>
          </div>
        )}
      </div>

      {/* Scan history */}
      {scanHistory.length > 0 && (
        <div className="shrink-0 max-h-[35vh] overflow-y-auto bg-slate-900 border-t border-slate-800">
          <div className="p-3 pb-1">
            <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">
              Letzte Scans ({scanHistory.length})
            </h3>
          </div>
          <div className="divide-y divide-slate-800">
            {scanHistory.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-800/50 transition-colors"
              >
                {s.granted ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
                ) : (
                  <XCircle className="h-5 w-5 text-red-400 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-slate-200 font-medium truncate">
                      {s.ticket
                        ? [s.ticket.firstName, s.ticket.lastName].filter(Boolean).join(" ") ||
                          s.ticket.name ||
                          s.code
                        : s.code}
                    </span>
                    {s.ticket?.ticketTypeName && (
                      <span className="text-xs text-slate-500 truncate hidden sm:inline">
                        {s.ticket.ticketTypeName}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 truncate">{s.message}</p>
                </div>
                <span className="flex items-center gap-1 text-xs text-slate-600 shrink-0">
                  <Clock className="h-3 w-3" />
                  {s.time.toLocaleTimeString("de-DE", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
