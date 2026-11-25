"use client";

import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, ArrowLeftRight, Ban, BarChart3, Clock, Cpu, CreditCard, Eye, EyeOff, Layers, Link2,
  LogIn, LogOut, MapPin, Package, Pencil, Plus, Repeat, ScanLine, Ticket, Timer, Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconChip } from "@/components/ui/icon-chip";
import { Notice } from "@/components/ui/notice";
import { Segmented } from "@/components/ui/segmented";
import { StatCard } from "@/components/ui/stat-card";
import { StatusDot } from "@/components/ui/status-dot";
import { cn } from "@/lib/utils";
import { formatScanLock } from "@/lib/area-tree";
import { AreaDialog, type AreaData, type AreaDevice, type AreaDialogTab } from "./area-dialog";

export interface AreaDetailData {
  area: AreaData;
  parent: { id: number; name: string } | null;
  children: { id: number; name: string; ticketCount: number }[];
  /** Zähler aus den Leser-Scans; null = keine Geräte. */
  rate: {
    inToday: number; in60: number; in15: number;
    outToday: number | null; out60: number | null;
    /** Geschätzt im Bereich (nur mit getrenntem Auslass). */
    inside: number | null;
  } | null;
  totals: {
    scans: number;
    granted: number;
    denied: number;
    guests: number;
    soldTickets: number;
    firstScanAt: string | null;
    lastScanAt: string | null;
    peakHour: { hour: string; count: number } | null;
  };
  average: { rides: number; guests: number; days: number } | null;
  hourly: { hour: string; granted: number; denied: number; total: number }[];
  weekTrend: { date: string; dayName: string; rides: number; denied: number; guests: number }[];
  ticketTypes: { name: string; rides: number; guests: number }[];
  denyReasons: { reason: string; count: number }[];
  devices: {
    id: number;
    name: string;
    type: string;
    category: string | null;
    direction: "IN" | "OUT" | "BOTH";
    isActive: boolean;
    /** null = Gerät meldet keinen Heartbeat (kein Pi). */
    online: boolean | null;
    lastUpdate: string | null;
    granted: number;
    denied: number;
    lastScanAt: string | null;
  }[];
  recentScans: {
    id: number;
    result: string;
    at: string;
    device: { id: number; name: string } | null;
    ticket: string | null;
    ticketType: string | null;
    reason: string | null;
  }[];
  tickets: { validNow: number; byStatus: Record<string, number> };
  services: { id: number; name: string; isMain: boolean }[];
  subscriptions: { id: number; name: string; ticketCount: number }[];
  annyLinks: string[];
  renderedAt: string;
}

interface Props {
  data: AreaDetailData;
  allAreas: AreaData[];
  editorDevices: AreaDevice[];
  annyResources: string[];
  annyServices: string[];
  annyMappings: Record<string, number>;
}

// recharts erst nachladen; der Platzhalter füllt die feste Diagrammhöhe.
const AreaScanChart = dynamic(() => import("./area-scan-chart").then((m) => m.AreaScanChart), {
  ssr: false,
  loading: () => <div className="glass-tile h-full animate-pulse" />,
});

const TZ = "Europe/Berlin";

const fmtNum = (n: number) => n.toLocaleString("de-DE");
const fmtHm = (iso: string) =>
  new Date(iso).toLocaleTimeString("de-DE", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

/** „14:32“ heute, sonst „12.11. 14:32“. */
function fmtWhen(iso: string, now: string): string {
  const d = new Date(iso);
  const sameDay = d.toLocaleDateString("de-DE", { timeZone: TZ }) === new Date(now).toLocaleDateString("de-DE", { timeZone: TZ });
  if (sameDay) return fmtHm(iso);
  return `${d.toLocaleDateString("de-DE", { timeZone: TZ, day: "2-digit", month: "2-digit" })} ${fmtHm(iso)}`;
}

/** „vor 3 Min“, „vor 2 Std“, „vor 4 Tagen“. */
function fmtAgo(iso: string, now: string): string {
  const min = Math.max(0, Math.round((new Date(now).getTime() - new Date(iso).getTime()) / 60_000));
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min} Min`;
  const h = Math.round(min / 60);
  if (h < 24) return `vor ${h} Std`;
  const d = Math.round(h / 24);
  return d === 1 ? "vor 1 Tag" : `vor ${d} Tagen`;
}

const DIRECTION: Record<"IN" | "OUT" | "BOTH", { label: string; icon: typeof LogIn }> = {
  IN: { label: "Einlass", icon: LogIn },
  OUT: { label: "Auslass", icon: LogOut },
  BOTH: { label: "Ein- und Auslass", icon: ArrowLeftRight },
};

const STATUS_ROWS: { key: string; label: string; variant: "success" | "info" | "warning" | "neutral" | "danger" }[] = [
  { key: "VALID", label: "Gültig", variant: "success" },
  { key: "REDEEMED", label: "Eingelöst", variant: "info" },
  { key: "PAUSED", label: "Pausiert", variant: "warning" },
  { key: "PROTECTED", label: "Geschützt", variant: "neutral" },
  { key: "INVALID", label: "Ungültig", variant: "neutral" },
  { key: "CANCELED", label: "Storniert", variant: "danger" },
];

/** Waagerechte Balkenliste (Ticketarten, Ablehnungsgründe). */
function BarList({ rows, barClass }: { rows: { key: string; label: string; value: number; sub?: string }[]; barClass: string }) {
  const max = rows.reduce((m, r) => Math.max(m, r.value), 0);
  return (
    <div className="space-y-2.5">
      {rows.map((row) => (
        <div key={row.key} className="space-y-1">
          <div className="flex items-center gap-2 text-xs">
            <span className="min-w-0 flex-1 truncate font-medium text-foreground">{row.label}</span>
            {row.sub && <span className="shrink-0 tabular-nums text-muted-foreground">{row.sub}</span>}
            <span className="shrink-0 font-semibold tabular-nums">{fmtNum(row.value)}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full rounded-full", barClass)} style={{ width: `${max > 0 ? (row.value / max) * 100 : 0}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Zeile „Beschriftung … Wert“ in einer Karte. */
function FactRow({ icon: Icon, label, children }: { icon: typeof LogIn; label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-11 items-center gap-3 border-b border-border py-2 last:border-0">
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1 text-[13px] text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right text-[13px] font-medium text-foreground">{children}</span>
    </div>
  );
}

export function AreaDetailView({ data, allAreas, editorDevices, annyResources, annyServices, annyMappings }: Props) {
  const router = useRouter();
  const [dialog, setDialog] = useState<{ open: boolean; tab?: AreaDialogTab; child?: boolean }>({ open: false });
  const [range, setRange] = useState<"day" | "week">("day");

  const { area, rate, totals, devices, now } = { ...data, now: data.renderedAt };
  const hasDevices = devices.length > 0;
  const limit = area.personLimit && area.personLimit > 0 ? area.personLimit : null;
  const lock = formatScanLock(area.scanLockSeconds);
  const offline = devices.filter((d) => d.isActive && d.online === false);
  const ticketTotal = Object.values(data.tickets.byStatus).reduce((a, b) => a + b, 0);

  // Stunden mit Betrieb: vom ersten bis zum letzten Scan, mindestens 08–20 Uhr.
  const hoursWithScans = data.hourly.map((h, i) => (h.total > 0 ? i : -1)).filter((i) => i >= 0);
  const fromHour = Math.min(8, ...hoursWithScans);
  const toHour = Math.max(20, ...hoursWithScans);
  const hourly = data.hourly.slice(fromHour, toHour + 1);

  const openDialog = (tab?: AreaDialogTab) => setDialog({ open: true, tab });

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Kopf des Objekts: zurück, Name mit Einordnung, eine Handlung. */}
      <div className="space-y-3">
        <Link
          href="/areas"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground max-sm:min-h-11"
        >
          <ArrowLeft className="size-4" />
          Alle Ressourcen
        </Link>
        <div className="flex flex-wrap items-start gap-3">
          <IconChip icon={data.children.length > 0 ? Layers : MapPin} tone={hasDevices ? "primary" : "neutral"} size="lg" />
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold leading-tight text-foreground sm:text-xl">{area.name}</h2>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              {data.parent ? (
                <>Unterressource von <Link href={`/areas/${data.parent.id}`} className="text-primary hover:underline">{data.parent.name}</Link></>
              ) : data.children.length > 0 ? (
                `Hauptressource mit ${data.children.length} ${data.children.length === 1 ? "Unterressource" : "Unterressourcen"}`
              ) : (
                "Hauptressource"
              )}
              {area.openingHours && <> · {area.openingHours}</>}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {area.allowReentry ? <Badge variant="success">Wiedereinlass</Badge> : <Badge variant="neutral">Einmalig</Badge>}
              {lock && <Badge variant="outline">Sperre {lock}</Badge>}
              {limit && <Badge variant="outline" className="tabular-nums">max. {fmtNum(limit)}</Badge>}
              {!area.showOnDashboard && <Badge variant="neutral">Nicht im Dashboard</Badge>}
            </div>
          </div>
          <Button variant="outline" onClick={() => openDialog("settings")} className="max-sm:h-11 max-sm:w-full">
            <Pencil className="size-4" />
            Bearbeiten
          </Button>
        </div>
      </div>

      {/* Lagebild des Tages (Abschnitt 8): Belegung, Einlass, Ablehnung, Tickets. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {rate?.inside != null ? (
          <StatCard
            label="Jetzt drin"
            value={fmtNum(rate.inside)}
            suffix={limit ? `von ${fmtNum(limit)}` : undefined}
            icon={Users}
            tone={limit && rate.inside >= limit ? "danger" : limit && rate.inside >= limit * 0.85 ? "warning" : "live"}
            progress={limit ? rate.inside / limit : undefined}
            hint="geschätzt aus Ein- und Auslass"
          />
        ) : (
          <StatCard
            label="Gäste heute"
            value={fmtNum(totals.guests)}
            suffix={limit ? `Limit ${fmtNum(limit)}` : undefined}
            icon={Users}
            tone="live"
            hint={hasDevices ? "Tickets mit gültigem Scan" : "ohne Gerät nicht gezählt"}
          />
        )}
        <StatCard
          label="Einlässe heute"
          value={fmtNum(rate?.inToday ?? 0)}
          icon={LogIn}
          tone="primary"
          hint={
            rate
              ? `letzte Stunde ${fmtNum(rate.in60)}${rate.outToday != null ? ` · Auslass ${fmtNum(rate.outToday)}` : ""}`
              : "kein Gerät am Einlass"
          }
        />
        <StatCard
          label="Abgelehnt heute"
          value={fmtNum(totals.denied)}
          icon={Ban}
          tone={totals.denied > 0 ? "danger" : "neutral"}
          hint={data.denyReasons[0] ? `meist: ${data.denyReasons[0].reason}` : "keine Ablehnung"}
        />
        <StatCard
          label="Gültige Tickets"
          value={fmtNum(data.tickets.validNow)}
          icon={Ticket}
          tone="primary"
          href={`/tickets?area=${area.id}`}
          hint={totals.soldTickets > 0 ? `${fmtNum(totals.soldTickets)} heute neu` : "Ansehen →"}
        />
      </div>

      {!hasDevices && (
        <Notice
          tone="info"
          title="Kein Gerät an dieser Ressource"
          action={
            editorDevices.length > 0 ? (
              <Button size="sm" variant="outline" onClick={() => openDialog("devices")} className="max-sm:h-11">
                <Cpu className="size-4" />
                Geräte zuordnen
              </Button>
            ) : undefined
          }
        >
          Ohne Leser am Einlass zählt die Seite keine Zutritte. Tickets und Regeln gelten trotzdem.
        </Notice>
      )}

      {offline.length > 0 && (
        <Notice tone="danger" title={`${offline.map((d) => d.name).join(", ")} ${offline.length === 1 ? "ist" : "sind"} offline`}>
          Seit mehr als 5 Minuten kein Lebenszeichen. Strom und Netzwerk am Gerät prüfen.
        </Notice>
      )}

      <div className="grid grid-cols-1 items-start gap-4 sm:gap-5 lg:grid-cols-3">
        {/* Linke Spalte: Verlauf, Geräte, letzte Scans. */}
        <div className="min-w-0 space-y-4 sm:space-y-5 lg:col-span-2">
          {hasDevices && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5">
                  <BarChart3 className="size-3.5 shrink-0 text-muted-foreground" />
                  {range === "day" ? "Heute nach Stunde" : "Letzte 7 Tage"}
                </CardTitle>
                <CardDescription>
                  {range === "day"
                    ? totals.peakHour
                      ? `Spitze um ${totals.peakHour.hour} mit ${fmtNum(totals.peakHour.count)} Scans${totals.firstScanAt ? ` · erster Scan ${fmtHm(totals.firstScanAt)}` : ""}`
                      : "Heute noch kein Scan."
                    : data.average
                      ? `Schnitt ${fmtNum(data.average.rides)} Einlässe und ${fmtNum(data.average.guests)} Gäste pro Tag`
                      : "Gültige und abgelehnte Scans je Tag."}
                </CardDescription>
                <CardAction>
                  <Segmented
                    value={range}
                    onValueChange={setRange}
                    size="sm"
                    aria-label="Zeitraum"
                    options={[
                      { value: "day", label: "Heute" },
                      { value: "week", label: "7 Tage" },
                    ]}
                  />
                </CardAction>
              </CardHeader>
              <CardContent>
                {range === "day" && totals.scans === 0 ? (
                  <EmptyState compact title="Heute noch kein Scan an dieser Ressource." />
                ) : (
                  <div className="h-[200px]">
                    <AreaScanChart
                      range={range}
                      data={range === "day" ? hourly : data.weekTrend.map((d) => ({ ...d, label: d.dayName }))}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card flush>
            <CardHeader>
              <CardTitle>Geräte ({devices.length})</CardTitle>
              <CardDescription>Leser an Einlass und Auslass, mit Scans von heute.</CardDescription>
              {editorDevices.length > 0 && (
                <CardAction>
                  <Button variant="outline" size="sm" onClick={() => openDialog("devices")} className="max-sm:h-11">
                    <Cpu className="size-4" />
                    Zuordnen
                  </Button>
                </CardAction>
              )}
            </CardHeader>
            <CardContent>
              {devices.length === 0 ? (
                <EmptyState compact title="Noch kein Gerät zugeordnet." className="pb-4" />
              ) : (
                <ul className="-mx-4 sm:-mx-[18px]">
                  {devices.map((d) => {
                    const dir = DIRECTION[d.direction];
                    const state = !d.isActive
                      ? { tone: "neutral" as const, text: "Inaktiv" }
                      : d.online === null
                        ? null
                        : d.online
                          ? { tone: "success" as const, text: "Online" }
                          : { tone: "danger" as const, text: d.lastUpdate ? `offline · ${fmtAgo(d.lastUpdate, now)}` : "nie online" };
                    return (
                      <li key={d.id} className="border-t border-border">
                        <Link
                          href={`/devices/${d.id}`}
                          className="flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-glass-tile sm:px-[18px]"
                        >
                          <IconChip icon={dir.icon} tone={d.isActive && d.online !== false ? "primary" : "neutral"} size="sm" />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-medium text-foreground">{d.name}</p>
                            <p className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
                              <span>{dir.label}</span>
                              {state && (
                                <>
                                  <span aria-hidden>·</span>
                                  <span className="inline-flex items-center gap-1">
                                    <StatusDot tone={state.tone} />
                                    {state.text}
                                  </span>
                                </>
                              )}
                              {d.lastScanAt && (
                                <>
                                  <span aria-hidden>·</span>
                                  <span className="tabular-nums">letzter Scan {fmtHm(d.lastScanAt)}</span>
                                </>
                              )}
                            </p>
                          </div>
                          <div className="shrink-0 text-right tabular-nums">
                            <p className="text-sm font-semibold text-foreground">{fmtNum(d.granted)}</p>
                            <p className={cn("text-[11px]", d.denied > 0 ? "text-destructive" : "text-muted-foreground")}>
                              {d.denied > 0 ? `${fmtNum(d.denied)} abgelehnt` : "heute"}
                            </p>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          {hasDevices && (
            <Card flush>
              <CardHeader>
                <CardTitle>Letzte Scans</CardTitle>
                <CardDescription>Die {data.recentScans.length} jüngsten Scans an den Geräten dieser Ressource.</CardDescription>
              </CardHeader>
              <CardContent>
                {data.recentScans.length === 0 ? (
                  <EmptyState compact title="Noch kein Scan." className="pb-4" />
                ) : (
                  <ul className="-mx-4 sm:-mx-[18px]">
                    {data.recentScans.map((s) => {
                      const ok = s.result === "GRANTED";
                      return (
                        <li key={s.id} className="flex min-h-11 items-center gap-3 border-t border-border px-4 py-2 sm:px-[18px]">
                          <span className="w-11 shrink-0 text-xs tabular-nums text-muted-foreground">{fmtWhen(s.at, now)}</span>
                          <StatusDot
                            tone={ok ? "success" : s.result === "PROTECTED" ? "warning" : "danger"}
                            label={ok ? "Gültig" : s.result === "PROTECTED" ? "Geschützt" : "Abgelehnt"}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] text-foreground">
                              {s.ticket ?? <span className="text-muted-foreground">Unbekannter Code</span>}
                            </p>
                            <p className="truncate text-[11px] text-muted-foreground">
                              {[s.reason, s.ticketType, s.device?.name].filter(Boolean).join(" · ")}
                            </p>
                          </div>
                          <Badge variant={ok ? "success" : s.result === "PROTECTED" ? "warning" : "danger"} className="shrink-0 max-sm:hidden">
                            {ok ? "Gültig" : s.result === "PROTECTED" ? "Geschützt" : "Abgelehnt"}
                          </Badge>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Rechte Spalte: Regeln, Tickets, Zugang, Hierarchie, Auswertung. */}
        <div className="min-w-0 space-y-4 sm:space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Regeln</CardTitle>
              <CardAction>
                <Button variant="ghost" size="sm" onClick={() => openDialog("settings")} className="max-sm:h-11">
                  <Pencil className="size-4" />
                  Ändern
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              <FactRow icon={Repeat} label="Wiedereinlass">
                {area.allowReentry ? "Ja, nach Auslass-Scan" : "Nein, einmalig"}
              </FactRow>
              <FactRow icon={Timer} label="Sperrzeit">{lock ?? "Aus"}</FactRow>
              <FactRow icon={Users} label="Personenlimit">{limit ? fmtNum(limit) : "Ohne Limit"}</FactRow>
              <FactRow icon={Clock} label="Öffnungszeiten">{area.openingHours || "Nicht hinterlegt"}</FactRow>
              <FactRow icon={area.showOnDashboard ? Eye : EyeOff} label="Im Dashboard">
                {area.showOnDashboard ? "Ja" : "Nein"}
              </FactRow>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tickets ({fmtNum(ticketTotal)})</CardTitle>
              <CardDescription>Direkt dieser Ressource zugeordnet.</CardDescription>
              <CardAction>
                <Button variant="ghost" size="sm" asChild className="max-sm:h-11">
                  <Link href={`/tickets?area=${area.id}`}>Alle</Link>
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              {ticketTotal === 0 ? (
                <EmptyState compact title="Keine Tickets an dieser Ressource." />
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {STATUS_ROWS.filter((r) => (data.tickets.byStatus[r.key] ?? 0) > 0).map((r) => (
                    <Badge key={r.key} variant={r.variant} className="tabular-nums">
                      {r.label} {fmtNum(data.tickets.byStatus[r.key])}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Zugang über</CardTitle>
              <CardDescription>Was Tickets für diese Ressource freigibt.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.services.length + data.subscriptions.length + data.annyLinks.length === 0 && (
                <EmptyState compact title="Weder Service noch Abo verknüpft." />
              )}
              {data.services.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-label flex items-center gap-1.5"><Package className="size-3.5" /> Services</p>
                  <div className="flex flex-wrap gap-1.5">
                    {data.services.map((s) => (
                      <Badge key={s.id} variant={s.isMain ? "accent" : "secondary"} asChild>
                        <Link href={`/tickets?svc=${s.id}`} title={s.isMain ? "Hauptressource dieses Service" : undefined}>
                          {s.name}{s.isMain && " · Haupt"}
                        </Link>
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {data.subscriptions.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-label flex items-center gap-1.5"><CreditCard className="size-3.5" /> Abos</p>
                  <div className="flex flex-wrap gap-1.5">
                    {data.subscriptions.map((s) => (
                      <Badge key={s.id} variant="secondary" asChild>
                        <Link href={`/tickets?sub=${s.id}`}>
                          {s.name} <span className="tabular-nums text-muted-foreground">{fmtNum(s.ticketCount)}</span>
                        </Link>
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {(data.annyLinks.length > 0 || annyResources.length + annyServices.length > 0) && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <p className="text-label flex flex-1 items-center gap-1.5"><Link2 className="size-3.5" /> anny</p>
                    <Button variant="ghost" size="xs" onClick={() => openDialog("anny")} className="max-sm:h-11">
                      Verknüpfen
                    </Button>
                  </div>
                  {data.annyLinks.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {data.annyLinks.map((n) => <Badge key={n} variant="outline">{n}</Badge>)}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">Nicht mit anny verknüpft.</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card flush>
            <CardHeader>
              <CardTitle>Unterressourcen ({data.children.length})</CardTitle>
              <CardAction>
                <Button variant="ghost" size="sm" onClick={() => setDialog({ open: true, child: true })} className="max-sm:h-11">
                  <Plus className="size-4" />
                  Neu
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              {data.children.length === 0 ? (
                <p className="pb-4 text-xs text-muted-foreground">Keine. Unterressourcen bündeln Bereiche, z. B. Lifte unter einem Park.</p>
              ) : (
                <ul className="-mx-4 sm:-mx-[18px]">
                  {data.children.map((c) => (
                    <li key={c.id} className="border-t border-border">
                      <Link
                        href={`/areas/${c.id}`}
                        className="flex min-h-11 items-center gap-3 px-4 py-2 transition-colors hover:bg-glass-tile sm:px-[18px]"
                      >
                        <MapPin className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{c.name}</span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{fmtNum(c.ticketCount)} Tickets</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {hasDevices && data.ticketTypes.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5">
                  <ScanLine className="size-3.5 text-muted-foreground" />
                  Ticketarten heute
                </CardTitle>
                <CardDescription>Gültige Scans und Gäste je Art.</CardDescription>
              </CardHeader>
              <CardContent>
                <BarList
                  barClass="bg-primary"
                  rows={data.ticketTypes.map((t) => ({ key: t.name, label: t.name, value: t.rides, sub: `${fmtNum(t.guests)} Gäste` }))}
                />
              </CardContent>
            </Card>
          )}

          {data.denyReasons.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5">
                  <Ban className="size-3.5 text-muted-foreground" />
                  Ablehnungen heute
                </CardTitle>
              </CardHeader>
              <CardContent>
                <BarList
                  barClass="bg-destructive"
                  rows={data.denyReasons.map((r) => ({ key: r.reason, label: r.reason, value: r.count }))}
                />
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <AreaDialog
        open={dialog.open}
        area={dialog.child ? null : area}
        presetParentId={dialog.child ? area.id : null}
        initialTab={dialog.tab}
        allAreas={allAreas}
        devices={editorDevices}
        annyResources={annyResources}
        annyServices={annyServices}
        annyMappings={annyMappings}
        onClose={() => setDialog({ open: false })}
        onDeleted={() => router.push("/areas")}
      />
    </div>
  );
}
