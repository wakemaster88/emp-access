"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { cn } from "@/lib/utils";
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

function statusLabel(s: string): string {
  switch (s) {
    case "VALID":
      return "Gültig";
    case "REDEEMED":
      return "Eingelöst";
    case "INVALID":
      return "Ungültig";
    case "PAUSED":
      return "Pausiert";
    case "CANCELED":
      return "Gekündigt";
    case "PROTECTED":
      return "Geschützt";
    default:
      return s;
  }
}

function StatMini({
  icon: Icon,
  label,
  value,
  sub,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  sub?: string;
  color: string;
}) {
  return (
    <Card className="border-slate-200 dark:border-slate-800 py-0">
      <CardContent className="p-3 sm:p-4 flex items-center gap-3">
        <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center shrink-0", color)}>
          <Icon className="h-4 w-4 text-white" />
        </div>
        <div className="min-w-0">
          <p className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 tabular-nums">{value}</p>
          <p className="text-[10px] text-slate-500 truncate">{label}</p>
          {sub && <p className="text-[9px] text-slate-400 truncate">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
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
    <div className="space-y-4">
      <div className="rounded-lg border border-indigo-200/60 dark:border-indigo-900/40 bg-indigo-50/50 dark:bg-indigo-950/20 px-3 py-2.5 text-xs text-slate-600 dark:text-slate-400">
        <strong className="text-slate-800 dark:text-slate-200">E-Abo Auswertung:</strong> Zählt Scans nur
        innerhalb der jeweiligen Ticket-Gültigkeit (Start–Ende bzw. Abo-Standardzeitraum). So siehst du
        Besuchsverhalten pro elektronischem Abonnement.
      </div>

      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="space-y-1.5 flex-1 max-w-md">
          <Label className="text-xs">Abo auswählen</Label>
          <Select
            value={selectedId || "__all__"}
            onValueChange={(v) => setSelectedId(v === "__all__" ? "" : v)}
          >
            <SelectTrigger className="h-9 text-sm">
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
        <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => fetchData()} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Aktualisieren"}
        </Button>
      </div>

      {loading && !data && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
        </div>
      )}

      {!loading && subs.length === 0 && (
        <Card className="border-slate-200 dark:border-slate-800">
          <CardContent className="py-12 text-center text-sm text-slate-500">
            Noch keine Abos angelegt. Unter <strong>Abos</strong> kannst du Produkte definieren und Tickets
            zuordnen.
          </CardContent>
        </Card>
      )}

      {data && !selectedId && overview && overview.length === 0 && subs.length > 0 && (
        <Card className="border-slate-200 dark:border-slate-800">
          <CardContent className="py-12 text-center text-sm text-slate-500">
            Keine Tickets mit Abo-Zuordnung. Verknüpfe Tickets unter <strong>Tickets</strong> oder per
            Integration mit einem Abo.
          </CardContent>
        </Card>
      )}

      {data && !selectedId && overview && overview.length > 0 && (
        <Card className="border-slate-200 dark:border-slate-800">
          <CardContent className="p-0 sm:p-0">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-indigo-500" />
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Übersicht aller Abos</h3>
            </div>
            <Table>
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
                    <TableCell className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                      {row.grantedScans}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-rose-600 dark:text-rose-400 hidden md:table-cell">
                      {row.deniedScans}
                    </TableCell>
                    <TableCell className="text-right tabular-nums hidden lg:table-cell">
                      {row.uniqueHoldersWithVisits}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="text-[11px] text-slate-500 px-4 py-2 border-t border-slate-100 dark:border-slate-800">
              Wähle oben ein Abo für Tagesverlauf, Wochentage, Geräte und Besucherliste.
            </p>
          </CardContent>
        </Card>
      )}

      {data && selectedId && s && (
        <>
          <div>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-violet-500" />
              {data.selectedSubscription?.name ?? "Abo"}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Auswertungsfenster (Gültigkeiten): {fmtDate(data.rangeStart)} – {fmtDate(data.rangeEnd)}
            </p>
          </div>

          {s.totalTickets === 0 ? (
            <Card className="border-slate-200 dark:border-slate-800">
              <CardContent className="py-10 text-center text-sm text-slate-500">
                Für dieses Abo sind keine Tickets vorhanden.
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
                <StatMini
                  icon={Users}
                  label="Abo-Tickets"
                  value={s.totalTickets}
                  sub={`${s.activeTickets} aktiv`}
                  color="bg-violet-500"
                />
                <StatMini
                  icon={ScanLine}
                  label="Besuche (erlaubt)"
                  value={s.totalVisits}
                  sub={`${s.grantRate}% aller Scans erlaubt`}
                  color="bg-emerald-500"
                />
                <StatMini
                  icon={ShieldX}
                  label="Abgelehnt"
                  value={s.deniedCount}
                  sub="im Gültigkeitszeitraum"
                  color="bg-rose-500"
                />
                <StatMini
                  icon={ShieldCheck}
                  label="Inhaber mit Besuch"
                  value={s.uniqueHoldersWithVisits}
                  sub={`Ø ${s.avgVisitsPerHolder} Besuche`}
                  color="bg-sky-500"
                />
                <StatMini
                  icon={TrendingUp}
                  label="Stärkster Tag"
                  value={s.busiestDay ? fmtDate(s.busiestDay) : "–"}
                  sub={s.busiestDayCount ? `${s.busiestDayCount} Scans` : undefined}
                  color="bg-amber-500"
                />
                <StatMini
                  icon={CalendarDays}
                  label="Zeitraum"
                  value={`${fmtDate(data.rangeStart)}`}
                  sub={fmtDate(data.rangeEnd)}
                  color="bg-indigo-500"
                />
              </div>

              <Card className="border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/40">
                <CardContent className="p-3 sm:p-4 text-xs text-slate-600 dark:text-slate-400 space-y-1.5">
                  <p className="font-medium text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <BarChart3 className="h-3.5 w-3.5" />
                    Kurzanalyse
                  </p>
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
                <TabsList variant="line" className="w-full sm:w-auto">
                  <TabsTrigger value="verlauf">Tagesverlauf</TabsTrigger>
                  <TabsTrigger value="wochentag">Wochentag</TabsTrigger>
                  <TabsTrigger value="besucher">Besucher</TabsTrigger>
                </TabsList>
                <TabsContent value="verlauf" className="mt-3">
                  {data.timeline.length > 0 ? (
                    <Card className="border-slate-200 dark:border-slate-800">
                      <CardContent className="p-3 sm:p-5">
                        <div className="h-[240px] sm:h-[280px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={data.timeline} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                              <XAxis
                                dataKey="label"
                                tick={{ fontSize: 9, fill: "#94a3b8" }}
                                tickLine={false}
                                axisLine={false}
                                interval="preserveStartEnd"
                              />
                              <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                              <Tooltip
                                contentStyle={{
                                  backgroundColor: "#1e293b",
                                  border: "none",
                                  borderRadius: "8px",
                                  fontSize: "12px",
                                  color: "#e2e8f0",
                                }}
                              />
                              <Area
                                type="monotone"
                                dataKey="granted"
                                name="Erlaubt"
                                stackId="1"
                                stroke="#10b981"
                                fill="#10b981"
                                fillOpacity={0.35}
                              />
                              <Area
                                type="monotone"
                                dataKey="denied"
                                name="Abgelehnt"
                                stackId="1"
                                stroke="#f87171"
                                fill="#f87171"
                                fillOpacity={0.35}
                              />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      </CardContent>
                    </Card>
                  ) : (
                    <p className="text-sm text-slate-500 py-6 text-center">Keine Scans im angezeigten Zeitraum.</p>
                  )}
                </TabsContent>
                <TabsContent value="wochentag" className="mt-3">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    <Card className="border-slate-200 dark:border-slate-800">
                      <CardContent className="p-3 sm:p-5">
                        <div className="flex items-center gap-2 mb-2">
                          <Clock className="h-4 w-4 text-amber-500" />
                          <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                            Besuche nach Wochentag
                          </h4>
                        </div>
                        <div className="h-[200px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={data.byWeekday} margin={{ top: 0, right: 5, left: -20, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                              <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} />
                              <Tooltip
                                contentStyle={{
                                  backgroundColor: "#1e293b",
                                  border: "none",
                                  borderRadius: "8px",
                                  fontSize: "12px",
                                  color: "#e2e8f0",
                                }}
                              />
                              <Bar dataKey="visits" name="Erlaubte Scans" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </CardContent>
                    </Card>
                    {data.byDevice.length > 0 && (
                      <Card className="border-slate-200 dark:border-slate-800">
                        <CardContent className="p-3 sm:p-5">
                          <div className="flex items-center gap-2 mb-2">
                            <ScanLine className="h-4 w-4 text-indigo-500" />
                            <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300">Nach Gerät</h4>
                          </div>
                          <div className="h-[200px]">
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart
                                data={data.byDevice}
                                layout="vertical"
                                margin={{ top: 0, right: 5, left: 0, bottom: 0 }}
                              >
                                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                                <XAxis type="number" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                                <YAxis
                                  type="category"
                                  dataKey="name"
                                  width={100}
                                  tick={{ fontSize: 9, fill: "#94a3b8" }}
                                />
                                <Tooltip
                                  contentStyle={{
                                    backgroundColor: "#1e293b",
                                    border: "none",
                                    borderRadius: "8px",
                                    fontSize: "12px",
                                    color: "#e2e8f0",
                                  }}
                                />
                                <Bar dataKey="granted" stackId="a" fill="#10b981" name="Erlaubt" />
                                <Bar dataKey="denied" stackId="a" fill="#f87171" name="Abgelehnt" />
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </div>
                </TabsContent>
                <TabsContent value="besucher" className="mt-3">
                  <Card className="border-slate-200 dark:border-slate-800">
                    <CardContent className="p-0 sm:p-0">
                      <Table>
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
                              <TableCell>
                                <Badge variant="secondary" className="text-[10px] font-normal">
                                  {statusLabel(t.status)}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                                {t.grantedVisits}
                              </TableCell>
                              <TableCell className="text-right tabular-nums hidden md:table-cell">
                                {t.deniedScans}
                              </TableCell>
                              <TableCell className="hidden lg:table-cell text-xs text-slate-500">
                                {fmtDateTime(t.lastVisit)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
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
