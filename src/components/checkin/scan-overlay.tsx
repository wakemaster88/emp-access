"use client";

/**
 * Scan- und Kamera-Overlay des Check-in-Kiosks.
 * Ausgelagert aus src/app/checkin/[token]/page.tsx.
 */
import { useEffect, useState, useRef } from "react";
import { CheckCircle2, XCircle, ScanLine, Camera, Loader2, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CheckinTicket } from "./checkin-types";
import { OverlayGrip, overlayScrimClass, overlaySheetClass } from "./checkin-ui";
import { personName } from "./checkin-utils";

export function ScanOverlay({
  scanInput,
  setScanInput,
  onScan,
  scanLoading,
  scanResult,
  onClose,
  inputRef,
}: {
  scanInput: string;
  setScanInput: (v: string) => void;
  onScan: (code: string) => void;
  scanLoading: boolean;
  scanResult: { found: boolean; ticket?: CheckinTicket; message?: string } | null;
  onClose: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [inputRef]);

  return (
    <div className={cn("fixed inset-0 z-50 flex items-end sm:items-center justify-center", overlayScrimClass)} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className={cn(overlaySheetClass, "w-full sm:max-w-md p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] space-y-4")}>
        <OverlayGrip className="-mt-3" />
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <ScanLine className="h-5 w-5 text-primary" />
            Code scannen
          </h2>
          <Button
            variant="secondary"
            size="icon-lg"
            onClick={onClose}
            className="size-11 rounded-full text-muted-foreground hover:text-foreground sm:size-14"
            aria-label="Schließen"
          >
            <X className="size-5" />
          </Button>
        </div>

        {/* Kiosk: Feld und Taste 56 px hoch (docs/design-regeln.md, Abschnitt 20). */}
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            type="text"
            value={scanInput}
            onChange={(e) => setScanInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onScan(scanInput)}
            placeholder="Barcode scannen oder Code eingeben"
            className="h-14 flex-1 px-4 md:text-base"
            autoFocus
            autoComplete="off"
          />
          <Button
            onClick={() => onScan(scanInput)}
            disabled={scanLoading || !scanInput.trim()}
            className="h-14 px-5 font-semibold"
            aria-label="Suchen"
          >
            {scanLoading ? <Loader2 className="size-5 animate-spin" /> : <Search className="size-5" />}
          </Button>
        </div>

        {/* Ergebnis als Fläche in der Zustandsfarbe: grün gefunden, rot abgelehnt. */}
        {scanResult && !scanResult.found && (
          <div role="alert" className="rounded-tile border border-destructive/60 bg-destructive/20 p-4 flex items-center gap-3">
            <XCircle className="h-6 w-6 text-destructive shrink-0" />
            <p className="text-sm font-medium text-foreground">{scanResult.message ?? "Nicht gefunden"}</p>
          </div>
        )}

        {scanResult?.found && scanResult.ticket && (
          <div role="status" className="rounded-tile border border-success/60 bg-success/20 p-4 flex items-center gap-3">
            <CheckCircle2 className="h-6 w-6 text-success shrink-0" />
            <div>
              <p className="text-sm font-bold text-foreground">{personName(scanResult.ticket)}</p>
              <p className="text-xs text-muted-foreground">{scanResult.ticket.ticketTypeName ?? ""}</p>
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground text-center">Barcode-Scanner-Eingabe wird automatisch erkannt</p>
      </div>
    </div>
  );
}

export function CameraOverlay({ onCapture, onClose }: { onCapture: (dataUrl: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 960 } },
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setReady(true);
        }
      } catch {
        if (!cancelled) setError("Kamera-Zugriff nicht möglich");
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const capture = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    const size = 300;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const min = Math.min(vw, vh);
    const sx = (vw - min) / 2;
    const sy = (vh - min) / 2;
    ctx.drawImage(video, sx, sy, min, min, 0, 0, size, size);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    onCapture(canvas.toDataURL("image/jpeg", 0.8));
  };

  const handleClose = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    onClose();
  };

  return (
    // Kamerabild bleibt auf schwarzem Grund (docs/design-regeln.md, Abschnitt 15).
    <div className="fixed inset-0 z-[60] bg-black flex flex-col" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <div className="flex items-center justify-between p-4">
        <h2 className="text-white text-lg font-semibold">Foto aufnehmen</h2>
        <Button
          variant="secondary"
          size="icon-lg"
          onClick={handleClose}
          className="size-11 rounded-full sm:size-14"
          aria-label="Schließen"
        >
          <X className="size-5" />
        </Button>
      </div>

      <div className="flex-1 flex items-center justify-center relative overflow-hidden">
        {error ? (
          <p role="alert" className="text-destructive text-center px-8">{error}</p>
        ) : (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            {!ready && (
              <div className="absolute inset-0 flex items-center justify-center bg-black">
                <Loader2 className="h-10 w-10 text-white animate-spin" />
              </div>
            )}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-64 h-64 border-2 border-white/40 rounded-3xl" />
            </div>
          </>
        )}
      </div>

      {ready && !error && (
        <div className="p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] flex justify-center">
          <button
            onClick={capture}
            aria-label="Foto aufnehmen"
            className="w-20 h-20 rounded-full bg-white border-4 border-white/50 bg-clip-padding active:scale-90 transition-transform flex items-center justify-center outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <Camera className="h-8 w-8 text-black" />
          </button>
        </div>
      )}
    </div>
  );
}
