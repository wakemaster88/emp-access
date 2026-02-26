"use client";

import { useEffect, useRef } from "react";
import QRCode from "qrcode";

interface DeviceQrProps {
  value: string;
  size?: number;
}

export function DeviceQr({ value, size = 96 }: DeviceQrProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, value, {
        width: size,
        margin: 1,
        color: { dark: "#1e293b", light: "#f8fafc" },
      });
    }
  }, [value, size]);

  return (
    <canvas
      ref={canvasRef}
      className="rounded-lg border border-slate-200 dark:border-slate-700"
    />
  );
}
