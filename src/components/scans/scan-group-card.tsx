"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Hash, Ticket, Wifi } from "lucide-react";

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
      return <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">Erlaubt</Badge>;
    case "DENIED":
      return <Badge variant="destructive">Abgelehnt</Badge>;
    case "PROTECTED":
      return <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">Geschützt</Badge>;
    default:
      return <Badge variant="secondary">{result}</Badge>;
  }
}

export interface ScanGroupScan {
  id: number;
  scanTime: string;
  deviceName: string;
  result: string;
  ticketTypeName?: string | null;
}

export interface ScanGroupCardProps {
  ticketName: string;
  code: string;
  scans: ScanGroupScan[];
}

export function ScanGroupCard({ ticketName, code, scans }: ScanGroupCardProps) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? scans.length : Math.min(VISIBLE_INITIAL, scans.length);
  const hasMore = scans.length > VISIBLE_INITIAL;
  const hiddenCount = scans.length - VISIBLE_INITIAL;

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/30 overflow-hidden shadow-sm hover:shadow transition-shadow">
      <div className="px-3 py-2.5 sm:px-5 sm:py-3.5 flex flex-wrap items-center justify-between gap-2 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
        <div className="flex items-baseline gap-2 sm:gap-3 min-w-0">
          <span className="font-semibold text-sm sm:text-base text-slate-900 dark:text-slate-100 truncate">{ticketName}</span>
          <span className="inline-flex items-center gap-1 sm:gap-1.5 font-mono text-[10px] sm:text-xs text-slate-400 dark:text-slate-500 shrink-0 max-w-[120px] sm:max-w-none truncate">
            <Hash className="h-3 w-3 sm:h-3.5 sm:w-3.5 shrink-0" aria-hidden />
            {code}
          </span>
        </div>
        <Badge variant="secondary" className="text-xs font-normal shrink-0">
          {scans.length} Scan{scans.length !== 1 ? "s" : ""}
        </Badge>
      </div>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {scans.slice(0, visible).map((scan) => (
          <li
            key={scan.id}
            className="px-4 py-2.5 sm:px-5 sm:py-3 hover:bg-slate-50/80 dark:hover:bg-slate-800/30 transition-colors"
          >
            <div className="flex items-center gap-2 sm:gap-3">
              <span
                className={`shrink-0 w-2 h-2 rounded-full ${
                  scan.result === "GRANTED"
                    ? "bg-emerald-500"
                    : scan.result === "DENIED"
                      ? "bg-rose-500"
                      : "bg-amber-500"
                }`}
                aria-hidden
              />
              <span className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 tabular-nums shrink-0">
                {fmtDateTime(scan.scanTime)}
              </span>
              <span className="hidden sm:inline-flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-300 truncate min-w-0">
                <Wifi className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                {scan.deviceName}
              </span>
              {scan.ticketTypeName && (
                <span className="hidden md:inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 truncate min-w-0 max-w-[12rem]">
                  <Ticket className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                  <span className="truncate">{scan.ticketTypeName}</span>
                </span>
              )}
              <span className="ml-auto shrink-0">
                <ResultBadge result={scan.result} />
              </span>
            </div>
            <div className="sm:hidden flex items-center gap-2 mt-1 ml-4 text-xs text-slate-400">
              <Wifi className="h-3 w-3 shrink-0" aria-hidden />
              {scan.deviceName}
              {scan.ticketTypeName && (
                <>
                  <span className="text-slate-300 dark:text-slate-600">·</span>
                  {scan.ticketTypeName}
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      {hasMore && (
        <div className="border-t border-slate-100 dark:border-slate-800 px-4 py-2 sm:px-5">
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            {expanded ? "Weniger anzeigen" : `${hiddenCount} weitere anzeigen`}
          </button>
        </div>
      )}
    </div>
  );
}
