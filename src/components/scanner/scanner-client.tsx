"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useWakeLock } from "@/hooks/use-wake-lock";
import type { Html5Qrcode } from "html5-qrcode";

import {
  Camera,
  SwitchCamera,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  User,
  MapPin,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconChip } from "@/components/ui/icon-chip";
import { Notice } from "@/components/ui/notice";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** Die Bibliothek wird erst beim Start der Kamera geladen (dynamischer Import). */
type Html5QrcodeModule = typeof import("html5-qrcode");

/** Ursache im Kamera-Hinweis; die Meldung des Browsers steht klein darunter. */
const CAMERA_ERROR = "Kamera-Zugriff fehlgeschlagen";

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

export interface ScannerClientProps {
  /**
   * URL fuer das Areas-Listing.
   * Default: "/api/areas" (Session-Auth).
   * Token-Scanner: "/api/scanner/public/{token}/areas".
   */
  areasUrl?: string;
  /**
   * URL fuer den Scan-Check.
   * Default: "/api/scan-check" (Session-Auth).
   * Token-Scanner: "/api/scanner/public/{token}/scan-check".
   */
  scanCheckUrl?: string;
}

export function ScannerClient({
  areasUrl = "/api/areas",
  scanCheckUrl = "/api/scan-check",
}: ScannerClientProps = {}) {
  const [isScanning, setIsScanning] = useState(false);
  // Bildschirm wach halten, solange die Seite sichtbar ist.
  useWakeLock(true);
  const [isStarting, setIsStarting] = useState(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [lastResult, setLastResult] = useState<ScanResult | null>(null);
  const [scanHistory, setScanHistory] = useState<ScanResult[]>([]);
  const [areas, setAreas] = useState<AccessArea[]>([]);
  const [selectedArea, setSelectedArea] = useState<string>("all");
  const [error, setError] = useState<string | null>(null);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const html5Ref = useRef<Html5QrcodeModule | null>(null);
  const scannerRunningRef = useRef(false);
  const cooldownRef = useRef<string | null>(null);
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    fetch(areasUrl)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setAreas(data);
      })
      .catch(() => {});
  }, [areasUrl]);

  /**
   * Ergebnis als volle Fläche zeigen und nach 4 s ausblenden – auch einen
   * Netzwerkfehler, sonst bliebe das Kamerabild verdeckt.
   */
  const showResult = useCallback((result: ScanResult) => {
    setLastResult(result);
    if (resultTimerRef.current) clearTimeout(resultTimerRef.current);
    resultTimerRef.current = setTimeout(() => {
      if (mountedRef.current) setLastResult(null);
    }, 4000);
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
        const res = await fetch(scanCheckUrl, {
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

        showResult(result);
        setScanHistory((prev) => [result, ...prev].slice(0, 50));
        playTone(data.granted);
      } catch {
        showResult({
          id: crypto.randomUUID(),
          code,
          granted: false,
          message: "Netzwerkfehler",
          time: new Date(),
        });
        playTone(false);
      }
    },
    [selectedArea, scanCheckUrl, showResult]
  );

  const stopScannerSafe = useCallback(async () => {
    if (scannerRef.current) {
      try {
        const states = html5Ref.current?.Html5QrcodeScannerState;
        const state = scannerRef.current.getState();
        if (states && (state === states.SCANNING || state === states.PAUSED)) {
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

      const mod = html5Ref.current ?? (await import("html5-qrcode"));
      html5Ref.current = mod;
      const scanner = new mod.Html5Qrcode("scanner-viewport");
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
      const msg = err instanceof Error ? err.message : CAMERA_ERROR;
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
          const states = html5Ref.current?.Html5QrcodeScannerState;
          const state = scannerRef.current.getState();
          if (states && (state === states.SCANNING || state === states.PAUSED)) {
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
    // Füllt den Platz unter dem Kopf: im Dashboard die Inhaltsspalte (sie lässt
    // unten Luft für die Tab-Leiste), auf der öffentlichen Seite deren feste Höhe.
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Kamera-Modul: Werkzeugleiste und Bild liegen immer dunkel auf
          Schwarz – auch im hellen Dashboard, wie bei einer Kamera-App. `dark`
          stellt alle Farben darin auf ihre dunklen Werte; die Bereichsliste
          hängt am <body> und bekommt `dark` deshalb selbst. */}
      <div className="dark flex min-h-0 flex-1 flex-col bg-black text-foreground">
        {/* Werkzeugleiste: nur die Bedienung – Titel und Symbol stehen im Kopf der Seite. */}
        <div className="flex items-center justify-end p-3 bg-glass border-b border-border gap-2 shrink-0">
          <div className="flex items-center gap-2 shrink-0">
            {areas.length > 0 && (
              <Select value={selectedArea} onValueChange={setSelectedArea}>
                <SelectTrigger className="w-[140px] sm:w-[180px] text-xs data-[size=default]:h-11">
                  <SelectValue placeholder="Bereich" />
                </SelectTrigger>
                <SelectContent className="dark">
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
              className="size-11 text-muted-foreground hover:text-foreground"
              title="Kamera wechseln"
              aria-label="Kamera wechseln"
            >
              <SwitchCamera className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={isScanning ? stopScannerSafe : startScanner}
              className={cn("size-11", isScanning ? "text-destructive" : "text-success")}
              title={isScanning ? "Scanner stoppen" : "Scanner starten"}
              aria-label={isScanning ? "Scanner stoppen" : "Scanner starten"}
            >
              <Camera className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Camera viewport + result overlay */}
        <div className="relative flex-1 flex items-center justify-center bg-black overflow-hidden">
          {/* So hoch wie das Video und senkrecht mittig: Die Bildmitte (dort
              liest die Bibliothek den Code) liegt unter dem Rahmen unten. Ihre
              eigene Schattierung mit weißen Ecken rechnet mit der Videohöhe und
              stand als zweiter, verzogener Rahmen daneben – sie bleibt aus. */}
          <div id="scanner-viewport" className="w-full [&_#qr-shaded-region]:hidden" />

          {isStarting && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-10">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="h-8 w-8 text-primary animate-spin" />
                <p className="text-sm text-muted-foreground">Kamera wird gestartet...</p>
              </div>
            </div>
          )}

          {error && !isScanning && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-10 p-6">
              <Notice
                tone="danger"
                icon={XCircle}
                title={CAMERA_ERROR}
                className="w-full max-w-sm"
                action={
                  <Button onClick={startScanner} variant="outline" className="h-11">
                    Erneut versuchen
                  </Button>
                }
              >
                {error !== CAMERA_ERROR && <span className="block text-[11px]">{error}</span>}
              </Notice>
            </div>
          )}

          {/* Ergebnis als volle Fläche in der Zustandsfarbe: grün erlaubt,
              rot abgelehnt. Im Dunkeln ist Rot hell und trägt dunkle Schrift
              wie Erfolg und Hinweis. Ein Kamerafehler mit „Erneut versuchen“
              hat Vorrang. */}
          {lastResult && !(error && !isScanning) && (
            <div
              className={cn(
                "absolute inset-0 z-20 flex items-center justify-center p-6 transition-all duration-300 animate-in fade-in-0 zoom-in-95",
                lastResult.granted
                  ? "bg-success/95 text-success-foreground"
                  : "bg-destructive/95 text-destructive-foreground dark:text-background"
              )}
            >
              <div className="flex w-full max-w-md flex-col items-center gap-3 text-center">
                {lastResult.granted ? (
                  <CheckCircle2 className="h-16 w-16 shrink-0" />
                ) : (
                  <XCircle className="h-16 w-16 shrink-0" />
                )}
                <p className="text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">{lastResult.message}</p>
                {lastResult.ticket && (
                  <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-base">
                    {(lastResult.ticket.firstName || lastResult.ticket.lastName) && (
                      <span className="flex items-center gap-1.5 font-medium">
                        <User className="h-4 w-4" />
                        {[lastResult.ticket.firstName, lastResult.ticket.lastName]
                          .filter(Boolean)
                          .join(" ")}
                      </span>
                    )}
                    {lastResult.ticket.ticketTypeName && (
                      <span className="opacity-85">
                        {lastResult.ticket.ticketTypeName}
                      </span>
                    )}
                    {(lastResult.ticket.serviceName || lastResult.ticket.subscriptionName) && (
                      <span className="opacity-85">
                        {lastResult.ticket.subscriptionName || lastResult.ticket.serviceName}
                      </span>
                    )}
                    {lastResult.ticket.areaName && (
                      <span className="flex items-center gap-1.5 opacity-85">
                        <MapPin className="h-4 w-4" />
                        {lastResult.ticket.areaName}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Scan frame overlay when scanning but no result shown */}
          {isScanning && !lastResult && !isStarting && (
            <div className="absolute inset-0 pointer-events-none z-10 flex items-center justify-center">
              <div className="w-[70vmin] h-[70vmin] max-w-[350px] max-h-[350px] relative">
                <div className="absolute top-0 left-0 w-10 h-10 border-t-3 border-l-3 border-primary rounded-tl-xl" />
                <div className="absolute top-0 right-0 w-10 h-10 border-t-3 border-r-3 border-primary rounded-tr-xl" />
                <div className="absolute bottom-0 left-0 w-10 h-10 border-b-3 border-l-3 border-primary rounded-bl-xl" />
                <div className="absolute bottom-0 right-0 w-10 h-10 border-b-3 border-r-3 border-primary rounded-br-xl" />
                <div className="absolute top-1/2 left-2 right-2 h-0.5 bg-primary/50" />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Scan history: Glasleiste unter dem Kamera-Modul, folgt Hell/Dunkel. */}
      {scanHistory.length > 0 && (
        <div className="glass-bar shrink-0 max-h-[35vh] overflow-y-auto scrollbar-thin border-t border-border">
          <div className="p-3 pb-1">
            <h3 className="text-label tabular-nums mb-2">
              Letzte Scans ({scanHistory.length})
            </h3>
          </div>
          <div className="divide-y divide-border">
            {scanHistory.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-3 px-3 py-2.5 hover:bg-glass-tile transition-colors"
              >
                <IconChip
                  icon={s.granted ? CheckCircle2 : XCircle}
                  tone={s.granted ? "success" : "danger"}
                  size="sm"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-foreground font-medium truncate">
                      {s.ticket
                        ? [s.ticket.firstName, s.ticket.lastName].filter(Boolean).join(" ") ||
                          s.ticket.name ||
                          s.code
                        : s.code}
                    </span>
                    {s.ticket?.ticketTypeName && (
                      <span className="text-xs text-muted-foreground truncate hidden sm:inline">
                        {s.ticket.ticketTypeName}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{s.message}</p>
                </div>
                <span className="flex items-center gap-1 text-xs tabular-nums text-muted-foreground shrink-0">
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
