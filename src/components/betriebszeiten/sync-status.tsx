"use client";

import { useEffect, useState } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusDot, type StatusTone } from "@/components/ui/status-dot";
import type { DiffGroup } from "@/lib/opening-compare";
import type { SyncReport, SyncRow, SyncSide } from "@/lib/opening-sync";
import { cn } from "@/lib/utils";

type SideKey = "anny" | "website";
const SIDE_LABEL: Record<SideKey, string> = { anny: "anny", website: "Website" };

/** "2027-03-13" -> "13.03.2027". */
function date(ymd: string): string {
  return `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}.${ymd.slice(0, 4)}`;
}

/** "12:00–16:00" -> "12–16"; null -> "keine Angabe". */
function hours(value: string | null): string {
  if (value == null) return "keine Angabe";
  return value.replace(/(\d{2}):(\d{2})/g, (_, h: string, m: string) => (m === "00" ? String(Number(h)) : `${Number(h)}:${m}`));
}

function needsAttention(side: SyncSide): boolean {
  return side.state === "diff" || side.state === "empty" || side.state === "error";
}

const TONE: Record<SyncSide["state"], StatusTone> = {
  same: "success",
  diff: "warning",
  empty: "warning",
  unlinked: "neutral",
  error: "danger",
};

function headline(side: SyncSide, key: SideKey): string {
  switch (side.state) {
    case "same":
      return "gleich";
    case "diff": {
      const n = side.result?.differing ?? 0;
      return `${n} ${n === 1 ? "Tag" : "Tage"} anders`;
    }
    case "empty":
      return "keine Zeiten eingetragen";
    case "unlinked":
      return key === "anny" ? "nicht in anny" : "keine Seite";
    case "error":
      return "nicht erreichbar";
  }
}

/** Zweite Zeile: wo die erste Abweichung liegt bzw. bis wann die Quelle Zeiten hat. */
function hint(side: SyncSide, key: SideKey, to: string): string | null {
  if (side.state !== "diff" && side.state !== "empty") return null;
  const first = side.result?.groups[0];
  if (side.lastDay && side.lastDay < to) return `Zeiten nur bis ${date(side.lastDay)}`;
  if (!first) return null;
  return `ab ${date(first.first)}: hier ${hours(first.ours)}, ${SIDE_LABEL[key]} ${hours(first.theirs)}`;
}

function SideCell({ side, sideKey, to }: { side: SyncSide; sideKey: SideKey; to: string }) {
  const sub = hint(side, sideKey, to);
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-1.5">
        <StatusDot tone={TONE[side.state]} />
        <span className="sm:hidden text-muted-foreground">{SIDE_LABEL[sideKey]}:</span>
        <span className={cn("truncate", side.state === "unlinked" && "text-muted-foreground")}>
          {headline(side, sideKey)}
        </span>
      </div>
      {sub && <p className="truncate pl-3.5 text-[11px] text-muted-foreground tabular-nums">{sub}</p>}
    </div>
  );
}

function GroupList({ side, sideKey }: { side: SyncSide; sideKey: SideKey }) {
  const groups: DiffGroup[] = side.result?.groups ?? [];
  if (!needsAttention(side) || groups.length === 0) return null;
  const more = (side.result?.differing ?? 0) - groups.reduce((n, g) => n + g.days, 0);
  return (
    <div className="min-w-0 space-y-1">
      <p className="text-label text-muted-foreground">
        {SIDE_LABEL[sideKey]}
        {side.source ? ` · ${side.source}` : ""}
      </p>
      <ul className="space-y-0.5 text-[11px] tabular-nums">
        {groups.map((g) => (
          <li key={`${g.ours}|${g.theirs}|${g.first}`} className="min-w-0">
            <span className="font-medium">
              {g.first === g.last ? date(g.first) : `${date(g.first)}–${date(g.last)}`}
            </span>{" "}
            <span className="text-muted-foreground">
              ({g.days} {g.days === 1 ? "Tag" : "Tage"}): hier {hours(g.ours)}, {SIDE_LABEL[sideKey]} {hours(g.theirs)}
            </span>
          </li>
        ))}
        {more > 0 && <li className="text-muted-foreground">und {more} weitere Tage</li>}
      </ul>
      {sideKey === "website" && (side.fromAnny ?? 0) > 0 && (
        <p className="text-[11px] text-muted-foreground">
          Ohne eigenen Eintrag zeigt die Website die anny-Zeiten ({side.fromAnny} Tage).
        </p>
      )}
    </div>
  );
}

function RowView({ row, to, expanded, onToggle }: { row: SyncRow; to: string; expanded: boolean; onToggle: () => void }) {
  const attention = needsAttention(row.anny) || needsAttention(row.website);
  return (
    <li className="border-t first:border-t-0">
      <button
        type="button"
        onClick={onToggle}
        disabled={!attention}
        aria-expanded={attention ? expanded : undefined}
        className="grid w-full min-w-0 grid-cols-1 gap-1 py-2 text-left text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 enabled:cursor-pointer sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)_minmax(0,1fr)_1rem] sm:items-start sm:gap-3"
      >
        <span className="truncate font-medium">{row.name}</span>
        <SideCell side={row.anny} sideKey="anny" to={to} />
        <SideCell side={row.website} sideKey="website" to={to} />
        <span className="hidden sm:block" aria-hidden>
          {attention && (
            <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", expanded && "rotate-180")} />
          )}
        </span>
      </button>
      {expanded && attention && (
        <div className="grid min-w-0 grid-cols-1 gap-3 pb-3 sm:grid-cols-2 sm:pl-[calc(9rem+0.75rem)]">
          <GroupList side={row.anny} sideKey="anny" />
          <GroupList side={row.website} sideKey="website" />
        </div>
      )}
    </li>
  );
}

/**
 * Statusfeld oben auf /betriebszeiten: stimmen anny und die Website mit den
 * Betriebszeiten überein? Liest beide nur; gepflegt wird dort von Hand.
 */
export function SyncStatus() {
  const [report, setReport] = useState<SyncReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);

  // Jeder Druck auf „Neu prüfen“ zählt hoch und lädt neu; Zustand nur in den Rückrufen setzen.
  const [round, setRound] = useState(0);
  useEffect(() => {
    let alive = true;
    fetch("/api/betriebszeiten/abgleich", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Abgleich fehlgeschlagen (${res.status})`);
        return (await res.json()) as SyncReport;
      })
      .then((data) => {
        if (!alive) return;
        setReport(data);
        setError("");
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : "Abgleich fehlgeschlagen");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [round]);

  function load() {
    setLoading(true);
    setRound((n) => n + 1);
  }

  const attention = report?.rows.filter((r) => needsAttention(r.anny) || needsAttention(r.website)).length ?? 0;
  const checked = report
    ? new Date(report.checkedAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" })
    : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <CardTitle>
            <h3>Abgleich mit anny und Website</h3>
          </CardTitle>
          {loading ? (
            <Badge variant="neutral">wird geprüft</Badge>
          ) : error ? (
            <Badge variant="danger">Fehler</Badge>
          ) : attention === 0 ? (
            <Badge variant="success">alles gleich</Badge>
          ) : (
            <Badge variant="warning">
              {attention} {attention === 1 ? "Bereich weicht" : "Bereiche weichen"} ab
            </Badge>
          )}
        </div>
        <CardDescription className="text-xs">
          {report
            ? `Tag für Tag bis ${date(report.to)}, geprüft um ${checked} Uhr. Nur lesen, gepflegt wird in anny und auf der Website.`
            : "Vergleicht die nächsten 12 Monate Tag für Tag mit anny und der Website."}
        </CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" className="max-sm:h-11" onClick={load} disabled={loading}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin motion-reduce:animate-none")} />
            <span>
              <span className="max-sm:sr-only">Neu </span>prüfen
            </span>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-xs text-destructive">{error}</p>
        ) : !report ? (
          <p className="text-xs text-muted-foreground">anny und Website werden gelesen …</p>
        ) : (
          <>
            <div
              aria-hidden
              className="hidden grid-cols-[minmax(0,9rem)_minmax(0,1fr)_minmax(0,1fr)_1rem] gap-3 pb-1 text-label text-muted-foreground sm:grid"
            >
              <span>Bereich</span>
              <span>anny</span>
              <span>Website</span>
              <span />
            </div>
            <ul>
              {report.rows.map((row) => (
                <RowView
                  key={row.scheduleId}
                  row={row}
                  to={report.to}
                  expanded={expanded === row.scheduleId}
                  onToggle={() => setExpanded((cur) => (cur === row.scheduleId ? null : row.scheduleId))}
                />
              ))}
            </ul>
            {(report.anny.error || report.website.error || !report.anny.configured || !report.website.configured) && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                {!report.anny.configured && "anny ist unter Schnittstellen nicht eingerichtet. "}
                {report.anny.error && `anny: ${report.anny.error}. `}
                {!report.website.configured && "Für die Website fehlt der Lesezugang (WEBSITE_DATABASE_URL). "}
                {report.website.error && `Website: ${report.website.error}.`}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
