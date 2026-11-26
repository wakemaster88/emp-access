"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  DoorOpen,
  MapPin,
  OctagonAlert,
  ScanLine,
  ShieldCheck,
  Users,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardHeader, CardTitle } from "@/components/ui/card";
import { GateDialog } from "@/components/dashboard/gate-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { IconChip } from "@/components/ui/icon-chip";
import { Notice } from "@/components/ui/notice";
import { StatCard } from "@/components/ui/stat-card";
import { cn } from "@/lib/utils";
import type { LiveAreaOccupancy, LiveWarning } from "@/lib/dashboard-live";
import type { AreaRate } from "@/lib/turnstile-rate";

export interface DashboardLive {
  at: string;
  warnings: LiveWarning[];
  access: {
    /** Geschätzt anwesend (nur Bereiche mit eigenem Ausgang), sonst null. */
    inside: number | null;
    in15: number;
    in60: number;
    inToday: number;
    denied15: number;
    denied60: number;
    deniedToday: number;
    areas: (AreaRate & { occupancy: LiveAreaOccupancy | null })[];
    recent: {
      id: number;
      result: "GRANTED" | "DENIED" | "PROTECTED";
      scanTime: string;
      deviceName: string | null;
      ticketId: number | null;
      name: string;
      typeName: string | null;
      reason: string | null;
    }[];
  };
  status: {
    readers: { online: number; total: number; offline: string[] };
    cameras: { online: number; total: number; offline: string[]; hubOnline: boolean };
    gates: {
      id: number;
      name: string;
      /** IP der Sprechstelle – darüber findet der Browser den Live-Stream in go2rtc. */
      host: string;
      snapshotAt: string | null;
      online: boolean;
      holdUntil: string | null;
      holdError: string | null;
    }[];
    lastOpening: { at: string; label: string | null } | null;
  };
  tracking: {
    persons: {
      today: number;
      known: number;
      blocked: number;
      unknown: number;
      last60: number;
      latest: { id: number; seenAt: string; name: string | null; listType: string | null; cameraName: string | null }[];
    };
    vehicles: {
      today: number;
      matched: number;
      unmatched: number;
      delivery: number;
      noParking: number;
      last60: number;
      latest: {
        id: number;
        seenAt: string;
        plate: string | null;
        name: string | null;
        matched: boolean;
        noParking: boolean;
        deliveryBrand: string | null;
        opened: boolean;
        cameraName: string | null;
      }[];
    };
    movement: {
      last60: number;
      cameras: { id: number; name: string; person: number; vehicle: number; other: number; total: number; lastAt: string }[];
    };
    parking: {
      trackerOnline: boolean;
      total: number;
      /** state fehlt bei einer älteren Cloud. */
      lots: { name: string; count: number; state?: "ok" | "unbekannt" }[];
    } | null;
  };
}

export function fmtHm(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

/** „vor 3 Min.“ für die Live-Listen; ab einer Stunde die Uhrzeit. */
export function fmtAgo(iso: string, now: number): string {
  const mins = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "gerade eben";
  if (mins < 60) return `vor ${mins} Min.`;
  return `${fmtHm(iso)} Uhr`;
}

/** Wie viele Warnungen einzeln stehen, bevor der Rest zusammengefasst wird. */
const MAX_WARNINGS = 5;

function Warnings({ warnings }: { warnings: LiveWarning[] }) {
  if (warnings.length === 0) {
    return (
      <Notice tone="success" compact icon={ShieldCheck} role="status" title="Alles ruhig">
        Keine offenen Warnungen, alle überwachten Geräte melden sich.
      </Notice>
    );
  }
  const shown = warnings.slice(0, MAX_WARNINGS);
  const rest = warnings.length - shown.length;
  return (
    <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
      {shown.map((w) => (
        <Link
          key={w.key}
          href={w.href}
          className="block min-w-0 rounded-tile outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <Notice
            tone={w.tone}
            compact
            icon={w.tone === "danger" ? OctagonAlert : AlertTriangle}
            title={w.title}
            className={cn(
              "h-full min-h-11 transition-colors",
              w.tone === "danger" ? "hover:border-destructive/70" : "hover:border-warning/70",
            )}
          >
            {(w.detail || w.at) && (
              <span className="block break-words">
                {w.detail}
                {w.detail && w.at && " · "}
                {w.at && <span className="tabular-nums">{fmtHm(w.at)} Uhr</span>}
              </span>
            )}
          </Notice>
        </Link>
      ))}
      {rest > 0 && (
        <p className="text-xs text-muted-foreground lg:col-span-2">
          und {rest} weitere {rest === 1 ? "Meldung" : "Meldungen"}
        </p>
      )}
    </div>
  );
}

const LEVEL_BADGE = { none: "neutral", low: "success", medium: "info", high: "warning" } as const;

type LiveArea = DashboardLive["access"]["areas"][number];

/**
 * Kennzahl je Bereich: am Lift die Fahrer der letzten Stunde, am Strandbad
 * die geschätzten Gäste (beides wie in der Kunden-App), sonst Anwesende
 * gegen das Limit oder Zutritte der letzten Stunde.
 */
function AreaTile({ area, className }: { area: LiveArea; className?: string }) {
  const occ = area.occupancy;
  const limit = area.personLimit;
  const fmt = (n: number) => n.toLocaleString("de-DE");
  let value: string;
  let suffix: string;
  let hint: string;
  let progress: number | undefined;
  let over = false;

  if (occ?.kind === "lift") {
    value = fmt(occ.riders);
    suffix = "Fahrer";
    hint = `${fmt(occ.starts)} Fahrten in 60 Min. · ${fmt(area.inToday)} heute`;
  } else if (occ?.kind === "beach") {
    value = `ca. ${fmt(occ.estimated)}`;
    suffix = "Gäste";
    hint = `${fmt(area.in60)} rein in 60 Min. · ${fmt(area.inToday)} heute`;
    if (occ.capacity) {
      progress = occ.estimated / occ.capacity;
      over = occ.estimated > occ.capacity;
    }
  } else if (area.inside != null) {
    value = fmt(area.inside);
    suffix = limit != null ? `von ${fmt(limit)} drin` : "drin";
    hint = `${fmt(area.in15)} rein in 15 Min. · ${fmt(area.inToday)} heute`;
    if (limit) {
      progress = area.inside / limit;
      over = area.inside > limit;
    }
  } else {
    value = fmt(area.in60);
    suffix = "in 60 Min.";
    hint = `${fmt(area.in15)} in 15 Min. · ${fmt(area.inToday)} heute`;
  }

  const tone = over
    ? "danger"
    : occ?.level === "high" || (progress != null && progress >= 0.8)
      ? "warning"
      : area.in15 > 0
        ? "live"
        : "neutral";

  return (
    <StatCard
      href={`/areas/${area.id}`}
      label={area.name}
      icon={MapPin}
      tone={tone}
      value={value}
      suffix={suffix}
      hint={hint}
      progress={progress}
      className={className}
    >
      {(occ || area.denied15 > 0) && (
        <span className="flex flex-wrap gap-1">
          {occ && (
            <Badge variant={LEVEL_BADGE[occ.level]} title="So zeigt es die Kunden-App gerade">
              {occ.label}
            </Badge>
          )}
          {area.denied15 > 0 && (
            <Badge variant="danger" className="tabular-nums">
              {area.denied15} abgelehnt
            </Badge>
          )}
        </span>
      )}
    </StatCard>
  );
}

export function LiveSection({
  live,
  now,
  onOpenTicket,
  side,
}: {
  live: DashboardLive;
  /** Uhrzeit des letzten Abrufs (ms), damit „vor 3 Min.“ beim Rendern rein bleibt. */
  now: number;
  onOpenTicket: (id: number) => void;
  /** Rechts neben „Letzte Scans“ (Desktop), darunter auf dem Handy: die Technik-Karte. */
  side?: React.ReactNode;
}) {
  const a = live.access;
  const s = live.status;
  const gate = s.gates[0];
  const [gateId, setGateId] = useState<number | null>(null);
  const openGate = s.gates.find((g) => g.id === gateId) ?? null;

  // Einsprung von außen (z. B. Push bei Klingeln): `/?doorbird=<Kamera-ID>`
  // öffnet die Tor-Ansicht direkt. Der Parameter wird danach entfernt, damit
  // ein Neuladen sie nicht erneut öffnet.
  const gateIds = s.gates.map((g) => g.id).join(",");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("doorbird") || !gateIds) return;
    const ids = gateIds.split(",").map(Number);
    const wanted = Number(params.get("doorbird"));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGateId(ids.includes(wanted) ? wanted : ids[0]);
    params.delete("doorbird");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }, [gateIds]);

  // Bereiche mit Betrieb heute als Kachel; ruhige nur als Zeile darunter
  // (Ruhe bei Normalbetrieb: keine Kachel mit lauter Nullen).
  const busy = a.areas.filter((area) => area.inToday > 0 || area.in60 > 0 || (area.inside ?? 0) > 0);
  const quiet = a.areas.filter((area) => !busy.includes(area));
  const tileCount = busy.length + (gate ? 1 : 0);

  return (
    <div className="space-y-3 sm:space-y-4">
      {openGate && (
        <GateDialog
          gate={openGate}
          hubOnline={s.cameras.hubOnline}
          open
          onOpenChange={(o) => {
            if (!o) setGateId(null);
          }}
        />
      )}
      <Warnings warnings={live.warnings} />

      <div className="space-y-2">
        <div
          className={cn(
            "grid grid-cols-2 gap-3 sm:gap-4",
            tileCount >= 4 ? "lg:grid-cols-4" : tileCount === 3 ? "lg:grid-cols-3" : "lg:grid-cols-2",
          )}
        >
          {busy.length === 0 && (
            // Kein Bereich mit Drehkreuz oder heute noch kein Einlass: Gesamtzahl wie bisher.
            <StatCard
              href="/scans"
              label="Einlässe heute"
              icon={Users}
              tone={a.in15 > 0 ? "live" : "neutral"}
              value={a.inToday}
              hint={a.deniedToday > 0 ? `${a.deniedToday} abgelehnt` : "keine Ablehnung"}
              className={gate ? undefined : "col-span-2 lg:col-span-1"}
            />
          )}
          {busy.map((area, i) => (
            <AreaTile
              key={area.id}
              area={area}
              // Ungerade Zahl an Kacheln: die letzte füllt auf dem Handy die Zeile.
              className={!gate && busy.length % 2 === 1 && i === busy.length - 1 ? "max-lg:col-span-2" : undefined}
            />
          ))}
          {gate && (
            <StatCard
              onClick={() => setGateId(gate.id)}
              label={gate.name}
              icon={DoorOpen}
              tone={gate.holdError ? "danger" : gate.holdUntil ? "warning" : gate.online ? "success" : "neutral"}
              value={gate.holdUntil ? "Offen" : gate.online ? "Bereit" : "Offline"}
              suffix={gate.holdUntil ? `bis ${fmtHm(gate.holdUntil)}` : undefined}
              hint={
                gate.holdError && gate.holdUntil
                  ? gate.holdError
                  : s.lastOpening
                    ? `zuletzt geöffnet ${fmtHm(s.lastOpening.at)}${s.lastOpening.label ? ` für ${s.lastOpening.label}` : ""}`
                    : "heute noch nicht für ein Fahrzeug geöffnet"
              }
              className={tileCount % 2 === 1 ? "max-lg:col-span-2" : undefined}
            />
          )}
        </div>
        {busy.length > 0 && quiet.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Heute noch ohne Einlass: {quiet.map((q) => q.name).join(" · ")}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="gap-3 lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <ScanLine className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              Letzte Scans
            </CardTitle>
            <CardAction>
              <Link
                href="/monitor"
                className="rounded-[10px] text-xs font-medium text-primary outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                Live-Monitor
              </Link>
            </CardAction>
          </CardHeader>
          <div className="max-h-[400px] divide-y divide-border/60 overflow-y-auto px-2 scrollbar-thin sm:px-2.5">
            {a.recent.length === 0 ? (
              <EmptyState compact icon={ScanLine} title="Heute noch kein Scan" />
            ) : (
              a.recent.map((scan) => {
                const granted = scan.result === "GRANTED";
                const row = (
                  <>
                    <IconChip
                      icon={granted ? CheckCircle2 : XCircle}
                      tone={granted ? "success" : scan.result === "DENIED" ? "danger" : "warning"}
                      size="sm"
                      className="rounded-full"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-foreground/90">{scan.name}</p>
                      <p className={cn("truncate text-[11px]", granted ? "text-muted-foreground" : "text-destructive")}>
                        {granted
                          ? [scan.typeName, scan.deviceName || "Unbekanntes Gerät"].filter(Boolean).join(" · ")
                          : [scan.reason || "Abgelehnt", scan.deviceName].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                      {fmtAgo(scan.scanTime, now)}
                    </span>
                  </>
                );
                const cls = "flex min-h-11 w-full items-center gap-2.5 px-2 py-2 text-left";
                return scan.ticketId != null ? (
                  <button
                    key={scan.id}
                    type="button"
                    onClick={() => onOpenTicket(scan.ticketId!)}
                    className={cn(
                      cls,
                      "outline-none transition-colors hover:bg-glass-tile focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    )}
                  >
                    {row}
                  </button>
                ) : (
                  <div key={scan.id} className={cls}>
                    {row}
                  </div>
                );
              })
            )}
          </div>
        </Card>
        {side}
      </div>
    </div>
  );
}
