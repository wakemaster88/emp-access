"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { SectionHeading } from "@/components/ui/section-heading";
import { StatCard } from "@/components/ui/stat-card";
// Ticket-Status in denselben Zustandsfarben wie die Tickettabelle.
import { statusBadge } from "@/components/tickets/edit-ticket-dialog";
import { cn } from "@/lib/utils";
import {
  Loader2,
  CreditCard,
  Users,
  ScanLine,
  ShieldCheck,
  ShieldX,
  BarChart3,
  CalendarDays,
  TrendingUp,
  Clock,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  BarChart,
  Bar,
} from "recharts";

// Diagramme nur aus Tokens (docs/design-regeln.md, Abschnitt 15).
const CHART_TOOLTIP_STYLE = {
  backgroundColor: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: "12px",
  boxShadow: "0 12px 32px -14px oklch(0 0 0 / 45%)",
  fontSize: "12px",
  color: "var(--popover-foreground)",
};
const CHART_GRID = "var(--border)";
const CHART_AXIS = "var(--muted-foreground)";

// Tabellen in Karten: Zeilen auf dem Handy mindestens 44 px hoch.
const TABLE_ROWS = "[&_td]:py-3 sm:[&_td]:py-2";

interface SubOption {
  id: number;
  name: string;
}

interface OverviewRow {
  id: number;
  name: string;
  ticketCount: number;
  activeTickets: number;
  grantedScans: number;
  deniedScans: number;
  uniqueHoldersWithVisits: number;
}

interface TicketRow {
  id: number;
  displayName: string;
  validFrom: string | null;
  validTo: string | null;
  status: string;
  grantedVisits: number;
  deniedScans: number;
  lastVisit: string | null;
}

interface EaboData {
  subscriptions: SubOption[];
  selectedSubscriptionId: number | null;
  selectedSubscription: { id: number; name: string } | null;
  overview?: OverviewRow[];
  rangeStart: string;
  rangeEnd: string;
  summary: {
    totalTickets: number;
    activeTickets: number;
    totalVisits: number;
    deniedCount: number;
    uniqueHoldersWithVisits: number;
    avgVisitsPerHolder: number;
    grantRate: number;
    busiestDay: string | null;
    busiestDayCount: number;
  };
  tickets: TicketRow[];
  timeline: { label: string; granted: number; denied: number }[];
  byDevice: { name: string; granted: number; denied: number; total: number }[];
  byWeekday: { label: string; visits: number }[];
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "–";
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "–";
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function EaboAnalytics() {
  const [selectedId, setSelectedId] = useState<string>("");
  const [data, setData] = useState<EaboData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedId) params.set("subscriptionId", selectedId);
      const res = await fetch(`/api/analytics/e-abo?${params}`);
      if (res.ok) setData(await res.json());
      else setData(null);
    } catch {
      setData(null);
    }
    setLoading(false);
  }, [selectedId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const subs = data?.subscriptions ?? [];
  const overview = data?.overview;
  const s = data?.summary;

  return (
    <div className="space-y-4 sm:space-y-5">
      <Notice tone="info" compact>
        <strong className="text-foreground">E-Abo Auswertung:</strong> Zählt Scans nur
        innerhalb der jeweiligen Ticket-Gültigkeit (Start–Ende bzw. Abo-Standardzeitraum). So siehst du
        Besuchsverhalten pro elektronischem Abonnement.
      </Notice>

      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="space-y-1.5 flex-1 max-w-md">
          <Label>Abo auswählen</Label>
          <Select
            value={selectedId || "__all__"}
            onValueChange={(v) => setSelectedId(v === "__all__" ? "" : v)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Alle Abos (Übersicht)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Alle Abos (Übersicht)</SelectItem>
              {subs.map((sub) => (
                <SelectItem key={sub.id} value={String(sub.id)}>
                  {sub.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="button" variant="outline" onClick={() => fetchData()} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Aktualisieren"}
        </Button>
      </div>

      {loading && !data && (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Lädt …
        </div>
      )}

      {!loading && subs.length === 0 && (
        <Card>
          <EmptyState
            icon={CreditCard}
            title="Noch keine Abos angelegt."
            description="Unter Abos kannst du Produkte definieren und Tickets zuordnen."
          />
        </Card>
      )}

      {data && !selectedId && overview && overview.length === 0 && subs.length > 0 && (
        <Card>
          <EmptyState
            icon={CreditCard}
            title="Keine Tickets mit Abo-Zuordnung."
            description="Verknüpfe Tickets unter Tickets oder per Integration mit einem Abo."
          />
        </Card>
      )}

      {data && !selectedId && overview && overview.length > 0 && (
        <Card flush="y">
          <CardHeader className="border-b pt-4 sm:pt-[18px]">
            <CardTitle className="flex items-center gap-1.5">
              <CreditCard className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <h3>Übersicht aller Abos</h3>
            </CardTitle>
          </CardHeader>
          <div className="px-2 sm:px-2.5">
            <Table className={TABLE_ROWS}>
              <TableHeader>
                <TableRow>
                  <TableHead>Abo</TableHead>
                  <TableHead className="text-right">Tickets</TableHead>
                  <TableHead className="text-right hidden sm:table-cell">Aktiv</TableHead>
                  <TableHead className="text-right">Besuche</TableHead>
                  <TableHead className="text-right hidden md:table-cell">Ablehnungen</TableHead>
                  <TableHead className="text-right hidden lg:table-cell">Inhaber m. Besuch</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overview.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.ticketCount}</TableCell>
                    <TableCell className="text-right tabular-nums hidden sm:table-cell">{row.activeTickets}</TableCell>
                    {/* Zustandsfarbe nur, wenn es etwas zu melden gibt; 0 bleibt ruhig. */}
                    <TableCell className={cn("text-right tabular-nums", row.grantedScans > 0 ? "text-success" : "text-muted-foreground")}>
                      {row.grantedScans}
                    </TableCell>
                    <TableCell className={cn("text-right tabular-nums hidden md:table-cell", row.deniedScans > 0 ? "text-destructive" : "text-muted-foreground")}>
                      {row.deniedScans}
                    </TableCell>
                    <TableCell className="text-right tabular-nums hidden lg:table-cell">
                      {row.uniqueHoldersWithVisits}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-[11px] text-muted-foreground px-4 sm:px-[18px] py-3 border-t border-border/60">
            Wähle oben ein Abo für Tagesverlauf, Wochentage, Geräte und Besucherliste.
          </p>
        </Card>
      )}

      {data && selectedId && s && (
        <>
          <SectionHeading
            title={data.selectedSubscription?.name ?? "Abo"}
            icon={CreditCard}
            description={`Auswertungsfenster (Gültigkeiten): ${fmtDate(data.rangeStart)} – ${fmtDate(data.rangeEnd)}`}
          />

          {s.totalTickets === 0 ? (
            <Card>
              <EmptyState compact title="Für dieses Abo sind keine Tickets vorhanden." />
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
                <StatCard
                  size="sm"
                  icon={Users}
                  label="Abo-Tickets"
                  value={s.totalTickets}
                  hint={`${s.activeTickets} aktiv`}
                  tone="primary"
                />
                <StatCard
                  size="sm"
                  icon={ScanLine}
                  label="Besuche (erlaubt)"
                  value={s.totalVisits}
                  hint={`${s.grantRate}% aller Scans erlaubt`}
                  tone="success"
                />
                <StatCard
                  size="sm"
                  icon={ShieldX}
                  label="Abgelehnt"
                  value={s.deniedCount}
                  hint="im Gültigkeitszeitraum"
                  tone="danger"
                />
                <StatCard
                  size="sm"
                  icon={ShieldCheck}
                  label="Inhaber mit Besuch"
                  value={s.uniqueHoldersWithVisits}
                  hint={`Ø ${s.avgVisitsPerHolder} Besuche`}
                  tone="info"
                />
                <StatCard
                  size="sm"
                  icon={TrendingUp}
                  label="Stärkster Tag"
                  value={s.busiestDay ? fmtDate(s.busiestDay) : "–"}
                  hint={s.busiestDayCount ? `${s.busiestDayCount} Scans` : undefined}
                  tone="neutral"
                />
                <StatCard
                  size="sm"
                  icon={CalendarDays}
                  label="Zeitraum"
                  value={`${fmtDate(data.rangeStart)}`}
                  hint={fmtDate(data.rangeEnd)}
                  tone="neutral"
                />
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-1.5">
                    <BarChart3 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    Kurzanalyse
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-[13px] text-muted-foreground">
                  <ul className="list-disc pl-4 space-y-0.5">
                    <li>
                      <strong>{s.uniqueHoldersWithVisits}</strong> von <strong>{s.totalTickets}</strong>{" "}
                      Inhabern haben mindestens einen erlaubten Scan im Abo-Zeitraum.
                    </li>
                    <li>
                      Durchschnittlich <strong>{s.avgVisitsPerHolder}</strong> erlaubte Besuche pro aktivem
                      Inhaber (nur mit mindestens einem Besuch).
                    </li>
                    <li>
                      Wochentagsverteilung unten zeigt, an welchen Wochentagen typischerweise eingecheckt wird.
                    </li>
                  </ul>
                </CardContent>
              </Card>

              <Tabs defaultValue="verlauf" className="w-full">
                <TabsList className="w-full sm:w-fit">
                  <TabsTrigger value="verlauf">Tagesverlauf</TabsTrigger>
                  <TabsTrigger value="wochentag">Wochentag</TabsTrigger>
                  <TabsTrigger value="besucher">Besucher</TabsTrigger>
                </TabsList>
                <TabsContent value="verlauf" className="mt-3">
                  {data.timeline.length > 0 ? (
                    <Card>
                      <CardContent>
                        <div className="h-[240px] sm:h-[280px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={data.timeline} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                              <XAxis
                                dataKey="label"
                                tick={{ fontSize: 9, fill: CHART_AXIS }}
                                tickLine={false}
                                axisLine={false}
                                interval="preserveStartEnd"
                              />
                              <YAxis tick={{ fontSize: 10, fill: CHART_AXIS }} tickLine={false} axisLine={false} />
                              <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                              <Area
                                type="monotone"
                                dataKey="granted"
                                name="Erlaubt"
                                stackId="1"
                                stroke="var(--success)"
                                fill="var(--success)"
                                fillOpacity={0.35}
                              />
                              <Area
                                type="monotone"
                                dataKey="denied"
                                name="Abgelehnt"
                                stackId="1"
                                stroke="var(--destructive)"
                                fill="var(--destructive)"
                                fillOpacity={0.35}
                              />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      </CardContent>
                    </Card>
                  ) : (
                    <Card>
                      <EmptyState compact title="Keine Scans im angezeigten Zeitraum." />
                    </Card>
                  )}
                </TabsContent>
                <TabsContent value="wochentag" className="mt-3">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <h4>Besuche nach Wochentag</h4>
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="h-[200px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={data.byWeekday} margin={{ top: 0, right: 5, left: -20, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
                              <XAxis dataKey="label" tick={{ fontSize: 10, fill: CHART_AXIS }} tickLine={false} axisLine={false} />
                              <YAxis tick={{ fontSize: 10, fill: CHART_AXIS }} tickLine={false} axisLine={false} />
                              <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                              <Bar dataKey="visits" name="Erlaubte Scans" fill="var(--chart-5)" radius={[4, 4, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </CardContent>
                    </Card>
                    {data.byDevice.length > 0 && (
                      <Card>
                        <CardHeader>
                          <CardTitle className="flex items-center gap-1.5">
                            <ScanLine className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <h4>Nach Gerät</h4>
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          {/* Eine Zeile je Gerät, damit Recharts keine Beschriftung ausblendet. */}
                          <div style={{ height: Math.max(200, data.byDevice.length * 28 + 30) }}>
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart
                                data={data.byDevice}
                                layout="vertical"
                                margin={{ top: 0, right: 5, left: 0, bottom: 0 }}
                              >
                                <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} horizontal={false} />
                                <XAxis type="number" tick={{ fontSize: 10, fill: CHART_AXIS }} tickLine={false} axisLine={false} />
                                <YAxis
                                  type="category"
                                  dataKey="name"
                                  width={110}
                                  interval={0}
                                  // style: Recharts misst Umbrüche nur darüber (sonst mit 16 px).
                                  tick={{ fontSize: 10, fill: CHART_AXIS, style: { fontSize: "10px" } }}
                                  tickLine={false}
                                  axisLine={false}
                                />
                                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                                <Bar dataKey="granted" stackId="a" fill="var(--success)" name="Erlaubt" />
                                <Bar dataKey="denied" stackId="a" fill="var(--destructive)" name="Abgelehnt" />
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                </TabsContent>
                <TabsContent value="besucher" className="mt-3">
                  <Card flush="y">
                    <div className="px-2 sm:px-2.5 py-1">
                      <Table className={TABLE_ROWS}>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Inhaber</TableHead>
                            <TableHead className="hidden sm:table-cell">Gültig von</TableHead>
                            <TableHead className="hidden sm:table-cell">Gültig bis</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Besuche</TableHead>
                            <TableHead className="text-right hidden md:table-cell">Abgelehnt</TableHead>
                            <TableHead className="hidden lg:table-cell">Letzter Besuch</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {data.tickets.map((t) => (
                            <TableRow key={t.id}>
                              <TableCell className="font-medium">{t.displayName}</TableCell>
                              <TableCell className="hidden sm:table-cell text-xs">{fmtDate(t.validFrom)}</TableCell>
                              <TableCell className="hidden sm:table-cell text-xs">{fmtDate(t.validTo)}</TableCell>
                              <TableCell>{statusBadge(t.status)}</TableCell>
                              <TableCell className={cn("text-right tabular-nums", t.grantedVisits > 0 ? "text-success" : "text-muted-foreground")}>
                                {t.grantedVisits}
                              </TableCell>
                              <TableCell className="text-right tabular-nums hidden md:table-cell">
                                {t.deniedScans}
                              </TableCell>
                              <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                                {fmtDateTime(t.lastVisit)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </Card>
                </TabsContent>
              </Tabs>
            </>
          )}
        </>
      )}
    </div>
  );
}
