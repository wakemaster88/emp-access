"use client";

/**
 * Scan- und Kamera-Overlay des Check-in-Kiosks.
 * Ausgelagert aus src/app/checkin/[token]/page.tsx.
 */
import { useEffect, useState, useRef } from "react";
import { CheckCircle2, XCircle, ScanLine, Camera, Loader2, Search, X } from "lucide-react";
import type { CheckinTicket } from "./checkin-types";
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
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="animate-slide-up bg-slate-900 border border-slate-700 rounded-t-2xl sm:rounded-3xl w-full sm:max-w-md p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <ScanLine className="h-5 w-5 text-indigo-400" />
            Code scannen
          </h2>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-800 text-slate-400">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={scanInput}
            onChange={(e) => setScanInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onScan(scanInput)}
            placeholder="Barcode scannen oder Code eingeben"
            className="flex-1 bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-3.5 text-base focus:outline-none focus:ring-2 focus:ring-indigo-500"
            autoFocus
            autoComplete="off"
          />
          <button
            onClick={() => onScan(scanInput)}
            disabled={scanLoading || !scanInput.trim()}
            className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-3.5 rounded-xl font-semibold transition-colors disabled:opacity-50 active:scale-95"
          >
            {scanLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
          </button>
        </div>

        {scanResult && !scanResult.found && (
          <div className="bg-rose-950 border border-rose-700/50 rounded-2xl p-4 flex items-center gap-3">
            <XCircle className="h-6 w-6 text-rose-400 shrink-0" />
            <p className="text-sm text-rose-200">{scanResult.message ?? "Nicht gefunden"}</p>
          </div>
        )}

        {scanResult?.found && scanResult.ticket && (
          <div className="bg-emerald-950 border border-emerald-700/50 rounded-2xl p-4 flex items-center gap-3">
            <CheckCircle2 className="h-6 w-6 text-emerald-400 shrink-0" />
            <div>
              <p className="text-sm font-bold text-emerald-200">{personName(scanResult.ticket)}</p>
              <p className="text-xs text-emerald-300/70">{scanResult.ticket.ticketTypeName ?? ""}</p>
            </div>
          </div>
        )}

        <p className="text-xs text-slate-500 text-center">Barcode-Scanner-Eingabe wird automatisch erkannt</p>
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
    <div className="fixed inset-0 z-[60] bg-black flex flex-col" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <div className="flex items-center justify-between p-4">
        <h2 className="text-white text-lg font-bold">Foto aufnehmen</h2>
        <button onClick={handleClose} className="p-2 rounded-xl bg-slate-800 text-white">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center relative overflow-hidden">
        {error ? (
          <p className="text-red-400 text-center px-8">{error}</p>
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
            className="w-20 h-20 rounded-full bg-white border-4 border-slate-300 active:scale-90 transition-transform flex items-center justify-center"
          >
            <Camera className="h-8 w-8 text-slate-900" />
          </button>
        </div>
      )}
    </div>
  );
}
