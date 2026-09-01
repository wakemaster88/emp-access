"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Eraser, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Unterschriftenfeld auf Canvas-Basis. Pointer-Events decken Finger, Stift und
 * Maus in einem Codepfad ab.
 *
 * Die Striche werden als Punktlisten gehalten und bei jeder Aenderung neu
 * gezeichnet – nur so laesst sich der letzte Strich zurueckziehen, und beim
 * Rotieren des Geraets bleibt die Unterschrift erhalten (Canvas verliert beim
 * Groessenwechsel sonst seinen Inhalt).
 */

type Point = { x: number; y: number };
type Stroke = Point[];

export interface SignaturePadHandle {
  /** PNG-Data-URL mit weissem Hintergrund, oder null wenn leer. */
  toDataUrl: () => string | null;
  clear: () => void;
}

interface SignaturePadProps {
  ref?: React.Ref<SignaturePadHandle>;
  onChangeEmpty?: (isEmpty: boolean) => void;
  disabled?: boolean;
  className?: string;
  height?: number;
}

const LINE_WIDTH = 2.2;
const LINE_COLOR = "#0f172a";

export function SignaturePad({
  ref,
  onChangeEmpty,
  disabled,
  className,
  height = 200,
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const currentRef = useRef<Stroke | null>(null);
  const [isEmpty, setIsEmpty] = useState(true);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = LINE_WIDTH;
    ctx.strokeStyle = LINE_COLOR;

    const all = currentRef.current
      ? [...strokesRef.current, currentRef.current]
      : strokesRef.current;

    for (const stroke of all) {
      if (stroke.length === 0) continue;
      ctx.beginPath();
      if (stroke.length === 1) {
        // Einzelner Tipp: als Punkt zeichnen, sonst bleibt er unsichtbar.
        ctx.arc(stroke[0]!.x, stroke[0]!.y, LINE_WIDTH / 2, 0, Math.PI * 2);
        ctx.fillStyle = LINE_COLOR;
        ctx.fill();
        continue;
      }
      ctx.moveTo(stroke[0]!.x, stroke[0]!.y);
      for (const point of stroke.slice(1)) ctx.lineTo(point.x, point.y);
      ctx.stroke();
    }
  }, [height]);

  // Aufloesung an Geraet und Containerbreite anpassen.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      canvas.height = Math.floor(height * dpr);
      redraw();
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [height, redraw]);

  const updateEmpty = useCallback(() => {
    const empty = strokesRef.current.length === 0;
    setIsEmpty(empty);
    onChangeEmpty?.(empty);
  }, [onChangeEmpty]);

  const pointFrom = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handleDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    currentRef.current = [pointFrom(e)];
    redraw();
  };

  const handleMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled || !currentRef.current) return;
    currentRef.current.push(pointFrom(e));
    redraw();
  };

  const handleUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!currentRef.current) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    strokesRef.current = [...strokesRef.current, currentRef.current];
    currentRef.current = null;
    redraw();
    updateEmpty();
  };

  const clear = useCallback(() => {
    strokesRef.current = [];
    currentRef.current = null;
    redraw();
    updateEmpty();
  }, [redraw, updateEmpty]);

  const undo = () => {
    strokesRef.current = strokesRef.current.slice(0, -1);
    redraw();
    updateEmpty();
  };

  useImperativeHandle(
    ref,
    () => ({
      clear,
      toDataUrl: () => {
        const canvas = canvasRef.current;
        if (!canvas || strokesRef.current.length === 0) return null;

        // Auf weissem Grund exportieren – das Canvas ist transparent und
        // waere im PDF sonst unsichtbar.
        const out = document.createElement("canvas");
        out.width = canvas.width;
        out.height = canvas.height;
        const ctx = out.getContext("2d");
        if (!ctx) return null;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, out.width, out.height);
        ctx.drawImage(canvas, 0, 0);
        return out.toDataURL("image/png");
      },
    }),
    [clear],
  );

  return (
    <div className={cn("space-y-1.5", className)}>
      <div
        className={cn(
          "relative rounded-md border-2 border-dashed bg-white",
          disabled
            ? "border-slate-200 opacity-60"
            : "border-slate-300 dark:border-slate-600",
        )}
      >
        <canvas
          ref={canvasRef}
          style={{ height, touchAction: "none" }}
          className="w-full rounded-md"
          onPointerDown={handleDown}
          onPointerMove={handleMove}
          onPointerUp={handleUp}
          onPointerCancel={handleUp}
          onPointerLeave={handleUp}
        />
        {isEmpty && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-400">
            Hier unterschreiben
          </span>
        )}
      </div>
      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={undo}
          disabled={disabled || isEmpty}
          className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 disabled:opacity-40 dark:hover:text-slate-200"
        >
          <Undo2 className="h-3.5 w-3.5" />
          Letzten Strich zurück
        </button>
        <button
          type="button"
          onClick={clear}
          disabled={disabled || isEmpty}
          className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-rose-600 disabled:opacity-40"
        >
          <Eraser className="h-3.5 w-3.5" />
          Löschen
        </button>
      </div>
    </div>
  );
}
