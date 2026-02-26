"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Camera, X, RotateCcw, ImageIcon } from "lucide-react";

interface CameraCaptureProps {
  onCapture: (dataUrl: string) => void;
  onClose: () => void;
}

export function CameraCapture({ onCapture, onClose }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState("");
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");

  useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, [facingMode]);

  async function startCamera() {
    stopCamera();
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      setStream(s);
      if (videoRef.current) {
        videoRef.current.srcObject = s;
      }
      setError("");
    } catch {
      setError("Kamera konnte nicht geöffnet werden");
    }
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      setStream(null);
    }
  }

  function capture() {
    const video = videoRef.current;
    if (!video) return;

    const canvas = document.createElement("canvas");
    const size = Math.min(video.videoWidth, video.videoHeight);
    canvas.width = 200;
    canvas.height = 200;
    const ctx = canvas.getContext("2d")!;

    const sx = (video.videoWidth - size) / 2;
    const sy = (video.videoHeight - size) / 2;
    ctx.drawImage(video, sx, sy, size, size, 0, 0, 200, 200);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
    stopCamera();
    onCapture(dataUrl);
  }

  function handleFileUpload(file: File) {
    if (file.size > 2_000_000) {
      setError("Bild max. 2 MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new window.Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const size = Math.min(img.width, img.height);
        canvas.width = 200;
        canvas.height = 200;
        const ctx = canvas.getContext("2d")!;
        const sx = (img.width - size) / 2;
        const sy = (img.height - size) / 2;
        ctx.drawImage(img, sx, sy, size, size, 0, 0, 200, 200);
        stopCamera();
        onCapture(canvas.toDataURL("image/jpeg", 0.8));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  function handleClose() {
    stopCamera();
    onClose();
  }

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden bg-black">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFileUpload(file);
          e.target.value = "";
        }}
      />

      <div className="relative aspect-[4/3] bg-black flex items-center justify-center">
        {error ? (
          <div className="text-center p-4">
            <p className="text-sm text-slate-400 mb-3">{error}</p>
            <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
              <ImageIcon className="h-4 w-4 mr-1.5" />
              Bild auswählen
            </Button>
          </div>
        ) : (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
        )}

        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-36 h-36 rounded-full border-2 border-white/40" />
        </div>

        <button
          type="button"
          onClick={handleClose}
          className="absolute top-2 right-2 p-1.5 rounded-full bg-black/50 text-white/80 hover:text-white hover:bg-black/70 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex items-center justify-between p-2 bg-slate-900">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          className="text-slate-400 hover:text-white hover:bg-slate-800"
        >
          <ImageIcon className="h-4 w-4 mr-1.5" />
          Datei
        </Button>

        <button
          type="button"
          onClick={capture}
          disabled={!stream}
          className="h-12 w-12 rounded-full border-4 border-white bg-white/20 hover:bg-white/40 transition-colors disabled:opacity-30 flex items-center justify-center"
        >
          <Camera className="h-5 w-5 text-white" />
        </button>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setFacingMode((m) => m === "user" ? "environment" : "user")}
          className="text-slate-400 hover:text-white hover:bg-slate-800"
          disabled={!stream}
        >
          <RotateCcw className="h-4 w-4 mr-1.5" />
          Drehen
        </Button>
      </div>
    </div>
  );
}
