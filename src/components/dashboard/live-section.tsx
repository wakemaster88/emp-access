"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  DoorOpen,
  LogIn,
  MapPin,
  OctagonAlert,
  ScanLine,
  ShieldCheck,
  Users,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GateDialog } from "@/components/dashboard/gate-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { IconChip } from "@/components/ui/icon-chip";
import { Notice } from "@/components/ui/notice";
import { StatCard } from "@/components/ui/stat-card";
import { cn } from "@/lib/utils";
import type { LiveWarning } from "@/lib/dashboard-live";
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
    areas: AreaRate[];
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
    parking: { trackerOnline: boolean; total: number; lots: { name: string; count: number }[] } | null;
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

function AreaRow({ area }: { area: AreaRate }) {
  const limit = area.personLimit;
  const hasInside = area.inside != null;
  // Mit Ausgang: Anwesende gegen das Limit. Ohne: Zutritte der letzten Stunde
  // (bei der Seilbahn fährt jeder Gast mehrfach, „heute“ gegen das Limit wäre falsch).
  const pct = hasInside && limit ? Math.min(100, Math.round((area.inside! / limit) * 100)) : null;
  const over = hasInside && limit != null && area.inside! > limit;
  return (
    <Link
      href={`/areas/${area.id}`}
      className="flex min-h-11 flex-col justify-center gap-1.5 rounded-[10px] px-2 py-2 outline-none transition-colors hover:bg-glass-tile focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground/90">{area.name}</span>
        {area.denied15 > 0 && (
          <Badge variant="danger" className="tabular-nums">
            {area.denied15} abgelehnt
          </Badge>
        )}
        <span className="shrink-0 text-xs font-semibold tabular-nums text-foreground">
          {hasInside ? area.inside : area.in60}
          <span className="ml-1 font-normal text-muted-foreground">
            {hasInside ? (limit != null ? `/ ${limit} drin` : "drin") : "in 60 Min."}
          </span>
        </span>
      </div>
      {pct != null && (
        <span className="block h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
          <span
            className={cn(
              "block h-full rounded-full transition-[width] duration-300",
              over ? "bg-destructive" : pct >= 80 ? "bg-warning" : "bg-emerald-500 dark:bg-emerald-400",
            )}
            style={{ width: `${pct}%` }}
          />
        </span>
      )}
      <p className="text-[11px] tabular-nums text-muted-foreground">
        {area.in15} in 15 Min. · {area.inToday} heute rein
        {area.outToday != null && ` · ${area.outToday} raus`}
        {area.lastScanAt && ` · zuletzt ${fmtHm(area.lastScanAt)}`}
      </p>
    </Link>
  );
}

export function LiveSection({
  live,
  now,
  onOpenTicket,
}: {
  live: DashboardLive;
  /** Uhrzeit des letzten Abrufs (ms), damit „vor 3 Min.“ beim Rendern rein bleibt. */
  now: number;
  onOpenTicket: (id: number) => void;
}) {
  const a = live.access;
  const s = live.status;
  const gate = s.gates[0];
  const devicesTotal = s.readers.total + s.cameras.total;
  const devicesOnline = s.readers.online + s.cameras.online;
  const devicesOffline = [...s.readers.offline, ...s.cameras.offline];
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

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {a.inside != null ? (
          <StatCard
            label="Jetzt drin"
            icon={Users}
            tone="live"
            value={a.inside}
            suffix="geschätzt"
            hint={`${a.inToday} Einlässe heute`}
          />
        ) : (
          <StatCard
            label="Einlässe heute"
            icon={Users}
            tone="live"
            value={a.inToday}
            hint={a.deniedToday > 0 ? `${a.deniedToday} abgelehnt` : "keine Ablehnung"}
          />
        )}
        <StatCard
          label="Einlässe"
          icon={LogIn}
          tone={a.in15 > 0 ? "live" : "neutral"}
          value={a.in60}
          suffix="in 60 Min."
          hint={`${a.in15} in den letzten 15 Min.`}
        />
        <StatCard
          href="/scans"
          label="Ablehnungen"
          icon={XCircle}
          tone={a.denied15 > 0 ? "danger" : "neutral"}
          value={a.denied60}
          suffix="in 60 Min."
          hint={a.denied15 > 0 ? `${a.denied15} in den letzten 15 Min.` : `${a.deniedToday} heute`}
        />
        {gate ? (
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
          />
        ) : (
          <StatCard
            href="/devices"
            label="Leser und Kameras"
            icon={ScanLine}
            tone={devicesOffline.length > 0 ? "warning" : "success"}
            value={`${devicesOnline}/${devicesTotal}`}
            suffix="online"
            hint={devicesOffline.length > 0 ? `offline: ${devicesOffline.join(" · ")}` : "alle erreichbar"}
            progress={devicesTotal > 0 ? devicesOnline / devicesTotal : undefined}
          />
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="gap-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              Bereiche jetzt
            </CardTitle>
            <CardAction>
              <Badge variant="secondary" className="tabular-nums">
                {a.areas.length}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="px-2 sm:px-2.5">
            {a.areas.length === 0 ? (
              <EmptyState
                compact
                icon={MapPin}
                title="Kein Bereich mit Drehkreuz"
                description="Ordne einem Bereich unter Ressourcen ein Drehkreuz zu, dann zählt er hier mit."
              />
            ) : (
              <div className="divide-y divide-border/60">
                {a.areas.map((area) => (
                  <AreaRow key={area.id} area={area} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="gap-3">
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
          <div className="max-h-[420px] divide-y divide-border/60 overflow-y-auto px-2 scrollbar-thin sm:px-2.5">
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
      </div>
    </div>
  );
}
