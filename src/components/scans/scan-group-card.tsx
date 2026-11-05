"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { StatusDot } from "@/components/ui/status-dot";
import { Hash, Ticket, Wifi, Cctv } from "lucide-react";
import { scanDenyReasonLabel } from "@/lib/scan-deny-reason";

const VISIBLE_INITIAL = 3;

function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function ResultBadge({ result }: { result: string }) {
  switch (result) {
    case "GRANTED":
      return <Badge variant="success">Erlaubt</Badge>;
    case "DENIED":
      return <Badge variant="danger">Abgelehnt</Badge>;
    case "PROTECTED":
      return <Badge variant="warning">Geschützt</Badge>;
    default:
      return <Badge variant="secondary">{result}</Badge>;
  }
}

export interface ScanGroupScan {
  id: number;
  scanTime: string;
  deviceName: string;
  /// Dem Scan-Geraet zugeordnete Kamera (Device.cameraId) – ermoeglicht den
  /// Blick auf den Zugang direkt aus der Scan-Historie.
  cameraId?: number | null;
  cameraName?: string | null;
  /// Gesetzt, wenn der Hub ein Kamerabild zum Scan-Zeitpunkt gespeichert hat
  /// (ScanSnapshot). Dann wird dieses Bild statt des aktuellen gezeigt.
  snapshotCapturedAt?: string | null;
  result: string;
  ticketTypeName?: string | null;
  note?: string | null;
}

export interface ScanGroupCardProps {
  ticketName: string;
  code: string;
  scans: ScanGroupScan[];
}

export function ScanGroupCard({ ticketName, code, scans }: ScanGroupCardProps) {
  const [expanded, setExpanded] = useState(false);
  // Scan-ID, deren verknuepfte Kamera gerade als Inline-Schnappschuss offen ist.
  const [openCameraScanId, setOpenCameraScanId] = useState<number | null>(null);
  const visible = expanded ? scans.length : Math.min(VISIBLE_INITIAL, scans.length);
  const hasMore = scans.length > VISIBLE_INITIAL;
  const hiddenCount = scans.length - VISIBLE_INITIAL;

  return (
    // Gruppe als Glas-Kachel in der Karte; kein eigener Schatten (docs/design-regeln.md, Abschnitt 23).
    <div className="glass-tile overflow-hidden">
      {/* Gruppenkopf auf bg-glass-tile mit Haarlinie wie die Zeilen darunter (docs/design-regeln.md, Abschnitt 17). */}
      <div className="px-3 py-2.5 sm:px-5 sm:py-3.5 flex flex-wrap items-center justify-between gap-2 bg-glass-tile border-b border-border/60">
        <div className="flex items-baseline gap-2 sm:gap-3 min-w-0">
          <span className="font-semibold text-sm sm:text-base text-foreground truncate">{ticketName}</span>
          <span className="inline-flex items-center gap-1 sm:gap-1.5 font-mono text-[11px] sm:text-xs text-muted-foreground shrink-0 max-w-[120px] sm:max-w-none truncate">
            <Hash className="h-3 w-3 sm:h-3.5 sm:w-3.5 shrink-0" aria-hidden />
            {code}
          </span>
        </div>
        <Badge variant="secondary" className="font-normal shrink-0 tabular-nums">
          {scans.length} Scan{scans.length !== 1 ? "s" : ""}
        </Badge>
      </div>
      <ul className="divide-y divide-border/60">
        {scans.slice(0, visible).map((scan) => {
          const reason = scan.result !== "GRANTED" ? scanDenyReasonLabel(scan.note) : null;
          return (
            <li
              key={scan.id}
              className="px-4 py-2.5 sm:px-5 sm:py-3 hover:bg-glass-tile transition-colors"
            >
              <div className="flex items-center gap-2 sm:gap-3">
                <StatusDot
                  tone={
                    scan.result === "GRANTED"
                      ? "success"
                      : scan.result === "DENIED"
                        ? "danger"
                        : "warning"
                  }
                />
                <span className="text-xs sm:text-sm text-muted-foreground tabular-nums shrink-0">
                  {fmtDateTime(scan.scanTime)}
                </span>
                <span className="hidden sm:inline-flex items-center gap-1.5 text-sm text-foreground/80 truncate min-w-0">
                  <Wifi className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" aria-hidden />
                  {scan.deviceName}
                </span>
                {scan.ticketTypeName && (
                  <span className="hidden md:inline-flex items-center gap-1.5 text-sm text-muted-foreground truncate min-w-0 max-w-[12rem]">
                    <Ticket className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" aria-hidden />
                    <span className="truncate">{scan.ticketTypeName}</span>
                  </span>
                )}
                {reason && (
                  <span className="hidden lg:inline text-xs text-destructive italic truncate min-w-0 max-w-[14rem]">
                    {reason}
                  </span>
                )}
                {scan.cameraId != null && (
                  <button
                    type="button"
                    onClick={() => setOpenCameraScanId(openCameraScanId === scan.id ? null : scan.id)}
                    className={`hidden sm:inline-flex items-center gap-1 text-xs shrink-0 rounded-full border px-2 py-0.5 transition-colors ${
                      openCameraScanId === scan.id
                        ? "border-primary/30 text-primary bg-primary/8"
                        : "border-border text-muted-foreground hover:text-primary hover:border-primary/60"
                    }`}
                    title={`Kamera ${scan.cameraName ?? ""} anzeigen`}
                  >
                    <Cctv className="h-3 w-3" aria-hidden />
                    {scan.cameraName}
                  </button>
                )}
                <span className="ml-auto shrink-0">
                  <ResultBadge result={scan.result} />
                </span>
              </div>
              {/* Handy: einzige Stelle für das Gerät – umbrechen statt quetschen, lange Namen kürzen. */}
              <div className="sm:hidden mt-1 ml-4 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                <Wifi className="h-3 w-3 shrink-0" aria-hidden />
                <span className="min-w-0 truncate">{scan.deviceName}</span>
                {scan.ticketTypeName && (
                  <>
                    <span className="text-muted-foreground/50">·</span>
                    <span className="min-w-0 truncate">{scan.ticketTypeName}</span>
                  </>
                )}
                {scan.cameraId != null && (
                  // Tippfläche 44 px über eine unsichtbare Fläche (wie beim Baustein Checkbox), damit die Nebentextzeile nicht aufgeht.
                  <button
                    type="button"
                    onClick={() => setOpenCameraScanId(openCameraScanId === scan.id ? null : scan.id)}
                    className="relative inline-flex items-center gap-1 text-primary after:absolute after:-inset-x-1 after:-inset-y-3.5 after:content-['']"
                  >
                    <Cctv className="h-3 w-3" aria-hidden />
                    {scan.cameraName}
                  </button>
                )}
              </div>
              {reason && (
                <div className="lg:hidden mt-1 ml-4 text-xs italic text-destructive">
                  {reason}
                </div>
              )}
              {openCameraScanId === scan.id && scan.cameraId != null && (
                <div className="mt-2 ml-4 space-y-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={scan.snapshotCapturedAt
                      ? `/api/scans/${scan.id}/snapshot`
                      : `/api/cameras/${scan.cameraId}/snapshot`}
                    alt={`Schnappschuss ${scan.cameraName ?? "Kamera"}`}
                    className="max-w-xs w-full rounded-lg border border-border"
                  />
                  <p className="text-[11px] text-muted-foreground/70">
                    {scan.snapshotCapturedAt
                      ? `${scan.cameraName} – Aufnahme vom Scan (${fmtDateTime(scan.snapshotCapturedAt)})`
                      : `${scan.cameraName} – aktueller Schnappschuss (nicht der Scan-Zeitpunkt)`}
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {hasMore && (
        <div className="border-t border-border/60 px-4 py-2 sm:px-5">
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="inline-flex items-center text-xs font-medium text-primary hover:underline max-sm:min-h-11"
          >
            {expanded ? "Weniger anzeigen" : `${hiddenCount} weitere anzeigen`}
          </button>
        </div>
      )}
    </div>
  );
}
