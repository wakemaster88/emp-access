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
import { DayStrip, MonthAxis, TRACK } from "@/components/betriebszeiten/charts";
import { scheduleTree } from "@/components/betriebszeiten/series";

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

function headline(side: SyncSide, key: SideKey, sub = false): string {
  switch (side.state) {
    case "same":
      return side.viaEmp ? "gleich · übernimmt emp-access" : "gleich";
    case "diff": {
      const n = side.result?.differing ?? 0;
      return `${n} ${n === 1 ? "Tag" : "Tage"} anders`;
    }
    case "empty":
      return "keine Zeiten eingetragen";
    case "unlinked":
      if (key === "anny") return "nicht in anny";
      return sub ? "nicht auf der Website" : "keine Seite";
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

/** Farbband im Abgleich: gleich ruhig, anders deutlich, nicht eingetragen bleibt Spur. */
const MARK_STYLES: Record<string, string> = { g: "bg-success/45", a: "bg-warning" };
const MARK_LABELS: Record<string, string> = {
  g: "gleich",
  a: "anders",
  l: "nicht eingetragen, hier geschlossen",
};

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className={cn("h-2 w-4 rounded-full", MARK_STYLES.g)} />
        gleich
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className={cn("h-2 w-4 rounded-full", MARK_STYLES.a)} />
        anders
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className={cn("h-2 w-4 rounded-full", TRACK)} />
        nicht eingetragen (hier zu)
      </span>
    </div>
  );
}

function SideCell({
  side,
  sideKey,
  from,
  to,
  name,
  isSub,
}: {
  side: SyncSide;
  sideKey: SideKey;
  from: string;
  to: string;
  name: string;
  isSub: boolean;
}) {
  const sub = hint(side, sideKey, to);
  const text = headline(side, sideKey, isSub);
  return (
    <div className="grid min-w-0 grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1 sm:grid-cols-1">
      <span className="text-[11px] text-muted-foreground sm:hidden">{SIDE_LABEL[sideKey]}</span>
      {side.marks ? (
        <DayStrip
          marks={side.marks}
          from={from}
          styles={MARK_STYLES}
          labels={MARK_LABELS}
          ariaLabel={`${name}, ${SIDE_LABEL[sideKey]}: ${text}`}
        />
      ) : (
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          <StatusDot tone={TONE[side.state]} size="xs" />
          <span className="truncate">{text}</span>
        </span>
      )}
      {side.marks && (
        <p className="col-start-2 min-w-0 truncate text-[11px] tabular-nums sm:col-start-1">
          <span className={cn(side.state === "same" ? "text-muted-foreground" : "font-medium")}>{text}</span>
          {sub && <span className="text-muted-foreground"> · {sub}</span>}
        </p>
      )}
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

const GRID = "sm:grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)_minmax(0,1fr)_1rem]";

function RowView({
  row,
  color,
  isSub,
  from,
  to,
  expanded,
  onToggle,
}: {
  row: SyncRow;
  color: string;
  /** Unterprofil: eingerückt unter seinem Bereich. */
  isSub: boolean;
  from: string;
  to: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const attention = needsAttention(row.anny) || needsAttention(row.website);
  return (
    <li className="border-t first:border-t-0">
      <button
        type="button"
        onClick={onToggle}
        disabled={!attention}
        aria-expanded={attention ? expanded : undefined}
        className={cn(
          "grid w-full min-w-0 grid-cols-1 gap-1.5 py-2.5 text-left text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 enabled:cursor-pointer sm:items-start sm:gap-x-4",
          GRID,
        )}
      >
        <span className={cn("flex min-w-0 items-center gap-1.5 sm:pt-0.5", isSub && "pl-3.5")}>
          <span aria-hidden className={cn("size-2 shrink-0 rounded-full", color)} />
          <span className={cn("truncate", isSub ? "text-muted-foreground" : "font-medium")}>{row.name}</span>
          {attention && (
            <ChevronDown
              aria-hidden
              className={cn("ml-auto size-4 shrink-0 text-muted-foreground transition-transform sm:hidden", expanded && "rotate-180")}
            />
          )}
        </span>
        <SideCell side={row.anny} sideKey="anny" from={from} to={to} name={row.name} isSub={isSub} />
        <SideCell side={row.website} sideKey="website" from={from} to={to} name={row.name} isSub={isSub} />
        <span className="hidden sm:block" aria-hidden>
          {attention && (
            <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", expanded && "rotate-180")} />
          )}
        </span>
      </button>
      {expanded && attention && (
        <div className="grid min-w-0 grid-cols-1 gap-3 pb-3 sm:grid-cols-2 sm:pr-8 sm:pl-[calc(8.5rem+1rem)]">
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
              {attention} {attention === 1 ? "Profil weicht" : "Profile weichen"} ab
            </Badge>
          )}
        </div>
        <CardDescription className="text-xs">
          {report
            ? `Heute bis ${date(report.to)}, Tag für Tag; vergangene Tage zählen nicht. Geprüft um ${checked} Uhr, nur lesend.`
            : "Vergleicht heute und die nächsten 12 Monate Tag für Tag mit anny und der Website."}
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
            <Legend />
            {/* Spaltenköpfe mit Monatsachse; auf dem Handy eine Achse über allen Bändern. */}
            <div aria-hidden className={cn("mt-3 hidden gap-x-4 text-label text-muted-foreground sm:grid", GRID)}>
              <span>Bereich</span>
              <span>anny</span>
              <span>Website</span>
              <span />
              <span />
              <MonthAxis from={report.from} days={report.days} compact />
              <MonthAxis from={report.from} days={report.days} compact />
              <span />
            </div>
            <div aria-hidden className="mt-3 grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-2 sm:hidden">
              <span />
              <MonthAxis from={report.from} days={report.days} compact />
            </div>
            <ul>
              {scheduleTree(report.rows.map((r) => ({ ...r, id: r.scheduleId }))).map(({ item: row, sub, color }) => (
                <RowView
                  key={row.scheduleId}
                  row={row}
                  color={color}
                  isSub={sub}
                  from={report.from}
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
