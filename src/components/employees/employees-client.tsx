"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  IdCard, Plus, Search, RefreshCw, Pencil, Clock, MapPin, Cpu, AlertTriangle,
  CheckCircle2, XCircle, ShieldOff, KeyRound, History,
} from "lucide-react";
import { fmtDate, fmtDateTime } from "@/lib/utils";
import { EmployeeEditDialog } from "./employee-edit-dialog";
import { EmployeeHistoryDialog } from "./employee-history-dialog";

export interface AreaOption {
  id: number;
  name: string;
  parentId: number | null;
}

export interface DeviceOption {
  id: number;
  name: string;
  type: string;
  category: string | null;
}

export interface EmployeeListItem {
  id: number;
  uuid: string | null;
  name: string;
  firstName: string | null;
  lastName: string | null;
  rfidCode: string | null;
  email: string | null;
  startDate: string | null;
  endDate: string | null;
  status: "VALID" | "INVALID" | "PROTECTED" | "REDEEMED" | string;
  profileImage: string | null;
  ticketTypeName: string | null;
  hasSchedule: boolean;
  areas: { id: number; name: string }[];
  directDevices: { id: number; name: string; type: string | null }[];
  lastScan: { scanTime: string; result: string; deviceId: number | null } | null;
  updatedAt: string;
}

interface EmployeesClientProps {
  areas: AreaOption[];
  devices: DeviceOption[];
  empControlLastSync: Date | string | null;
}

export function EmployeesClient({ areas, devices, empControlLastSync }: EmployeesClientProps) {
  const [employees, setEmployees] = useState<EmployeeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [areaFilter, setAreaFilter] = useState<string>("all");
  const [editingId, setEditingId] = useState<number | "new" | null>(null);
  const [historyTarget, setHistoryTarget] = useState<{ id: number; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter === "VALID" || statusFilter === "INVALID" || statusFilter === "PROTECTED") {
        params.set("status", statusFilter);
      }
      if (areaFilter !== "all") params.set("areaId", areaFilter);
      if (search.trim()) params.set("q", search.trim());

      const res = await fetch(`/api/employees?${params}`);
      if (!res.ok) {
        setError(`Laden fehlgeschlagen (${res.status})`);
        return;
      }
      const list = (await res.json()) as EmployeeListItem[];
      setEmployees(list);
    } catch {
      setError("Netzwerkfehler beim Laden");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, areaFilter, search]);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  const filteredCounts = useMemo(() => {
    const now = new Date();
    let active = 0;
    let expired = 0;
    let blocked = 0;
    for (const e of employees) {
      const end = e.endDate ? new Date(e.endDate) : null;
      const isExpired = end ? end < now : false;
      if (e.status === "INVALID" || e.status === "PROTECTED") blocked++;
      else if (isExpired) expired++;
      else if (e.status === "VALID" || e.status === "REDEEMED") active++;
    }
    return { active, expired, blocked, total: employees.length };
  }, [employees]);

  function statusBadge(e: EmployeeListItem) {
    const now = new Date();
    const end = e.endDate ? new Date(e.endDate) : null;
    const isExpired = end ? end < now : false;

    if (e.status === "INVALID") {
      return (
        <Badge variant="destructive" className="gap-1 text-xs">
          <XCircle className="h-3 w-3" /> Inaktiv
        </Badge>
      );
    }
    if (e.status === "PROTECTED") {
      return (
        <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 gap-1 text-xs">
          <ShieldOff className="h-3 w-3" /> Gesperrt
        </Badge>
      );
    }
    if (isExpired) {
      return (
        <Badge className="bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400 gap-1 text-xs">
          <AlertTriangle className="h-3 w-3" /> Vertrag abgelaufen
        </Badge>
      );
    }
    return (
      <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 gap-1 text-xs">
        <CheckCircle2 className="h-3 w-3" /> Aktiv
      </Badge>
    );
  }

  return (
    <>
      <Card className="border-slate-200 dark:border-slate-800">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <CardTitle className="text-base sm:text-lg flex items-center gap-2">
              <IdCard className="h-5 w-5 text-indigo-500" />
              Mitarbeiter ({filteredCounts.total})
            </CardTitle>
            <div className="hidden sm:flex items-center gap-2">
              <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-xs">
                {filteredCounts.active} aktiv
              </Badge>
              {filteredCounts.expired > 0 && (
                <Badge className="bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400 text-xs">
                  {filteredCounts.expired} abgelaufen
                </Badge>
              )}
              {filteredCounts.blocked > 0 && (
                <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 text-xs">
                  {filteredCounts.blocked} blockiert
                </Badge>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {empControlLastSync && (
              <span className="text-xs text-slate-400 hidden md:flex items-center gap-1">
                <RefreshCw className="h-3 w-3" />
                EMP-Control: {fmtDateTime(empControlLastSync)}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => load()}
              disabled={loading}
              className="gap-1.5"
            >
              <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              Neu laden
            </Button>
            <Button size="sm" onClick={() => setEditingId("new")} className="bg-indigo-600 hover:bg-indigo-700 gap-1.5">
              <Plus className="h-4 w-4" /> Mitarbeiter
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Name, RFID oder Email suchen…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Aktiv (Default)</SelectItem>
                <SelectItem value="VALID">Nur VALID</SelectItem>
                <SelectItem value="INVALID">Nur Inaktiv</SelectItem>
                <SelectItem value="PROTECTED">Nur Gesperrt</SelectItem>
                <SelectItem value="all">Alle</SelectItem>
              </SelectContent>
            </Select>
            <Select value={areaFilter} onValueChange={setAreaFilter}>
              <SelectTrigger className="w-full sm:w-56">
                <SelectValue placeholder="Bereich" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Bereiche</SelectItem>
                {areas.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error && (
            <div className="rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-sm text-rose-700 dark:text-rose-400">
              {error}
            </div>
          )}

          <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-200 dark:border-slate-700 hover:bg-transparent bg-slate-50/80 dark:bg-slate-900/50">
                  <TableHead className="min-w-[220px] text-slate-600 dark:text-slate-400 font-medium">Mitarbeiter</TableHead>
                  <TableHead className="hidden sm:table-cell w-[160px] text-slate-600 dark:text-slate-400 font-medium">RFID / Email</TableHead>
                  <TableHead className="hidden md:table-cell w-[200px] text-slate-600 dark:text-slate-400 font-medium">Vertrag</TableHead>
                  <TableHead className="hidden md:table-cell min-w-[200px] text-slate-600 dark:text-slate-400 font-medium">Zugang</TableHead>
                  <TableHead className="w-[140px] text-slate-600 dark:text-slate-400 font-medium">Status</TableHead>
                  <TableHead className="hidden lg:table-cell w-[160px] text-slate-600 dark:text-slate-400 font-medium">Letzte Aktivität</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && employees.length === 0 && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={7} className="text-center py-10 text-slate-400 text-sm">
                      Lade Mitarbeiter…
                    </TableCell>
                  </TableRow>
                )}
                {!loading && employees.length === 0 && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={7} className="text-center py-16">
                      <div className="flex flex-col items-center gap-2 text-slate-500">
                        <IdCard className="h-10 w-10 text-slate-300 dark:text-slate-600" />
                        <p className="font-medium text-slate-600 dark:text-slate-400">Keine Mitarbeiter gefunden</p>
                        <p className="text-sm">Per EMP-Control-Webhook oder manuell über &bdquo;+ Mitarbeiter&ldquo; anlegen.</p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}

                {employees.map((e) => {
                  const fullName =
                    [e.firstName, e.lastName].filter(Boolean).join(" ") || e.name;
                  const initials = (e.firstName?.[0] ?? e.name[0] ?? "?") + (e.lastName?.[0] ?? "");
                  return (
                    <TableRow
                      key={e.id}
                      className="group cursor-pointer border-slate-200 dark:border-slate-700 hover:bg-indigo-50/50 dark:hover:bg-indigo-950/20 transition-colors"
                      onClick={() => setEditingId(e.id)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="h-9 w-9 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-xs font-bold shrink-0 overflow-hidden">
                            {e.profileImage ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={e.profileImage} alt="" className="h-full w-full object-cover" />
                            ) : (
                              initials.toUpperCase()
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                              {fullName}
                            </p>
                            <p className="text-xs text-slate-500 truncate">
                              {e.ticketTypeName ?? "Mitarbeiter"}
                              {e.hasSchedule && (
                                <span className="ml-1.5 inline-flex items-center gap-0.5 text-amber-600 dark:text-amber-400">
                                  <Clock className="h-3 w-3" /> Plan
                                </span>
                              )}
                            </p>
                          </div>
                        </div>
                      </TableCell>

                      <TableCell className="hidden sm:table-cell">
                        <div className="space-y-0.5">
                          {e.rfidCode ? (
                            <p className="text-xs font-mono text-slate-700 dark:text-slate-300 inline-flex items-center gap-1">
                              <KeyRound className="h-3 w-3 text-slate-400" />
                              {e.rfidCode}
                            </p>
                          ) : (
                            <p className="text-xs text-slate-400">—</p>
                          )}
                          {e.email && (
                            <p className="text-[11px] text-slate-400 truncate max-w-[160px]">{e.email}</p>
                          )}
                        </div>
                      </TableCell>

                      <TableCell className="hidden md:table-cell">
                        <div className="text-xs text-slate-600 dark:text-slate-400">
                          {e.startDate || e.endDate ? (
                            <>
                              <p>{e.startDate ? fmtDate(e.startDate) : "—"} <span className="text-slate-400">bis</span></p>
                              <p>{e.endDate ? fmtDate(e.endDate) : "unbefristet"}</p>
                            </>
                          ) : (
                            <p className="text-slate-400">unbefristet</p>
                          )}
                        </div>
                      </TableCell>

                      <TableCell className="hidden md:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {e.areas.length === 0 && e.directDevices.length === 0 && (
                            <span className="text-xs text-slate-400">Kein Zugang</span>
                          )}
                          {e.areas.slice(0, 3).map((a) => (
                            <Badge key={a.id} variant="secondary" className="text-[10px] gap-1">
                              <MapPin className="h-2.5 w-2.5" /> {a.name}
                            </Badge>
                          ))}
                          {e.areas.length > 3 && (
                            <Badge variant="secondary" className="text-[10px]">+{e.areas.length - 3}</Badge>
                          )}
                          {e.directDevices.slice(0, 2).map((d) => (
                            <Badge key={d.id} className="bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400 text-[10px] gap-1">
                              <Cpu className="h-2.5 w-2.5" /> {d.name}
                            </Badge>
                          ))}
                          {e.directDevices.length > 2 && (
                            <Badge className="bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400 text-[10px]">+{e.directDevices.length - 2}</Badge>
                          )}
                        </div>
                      </TableCell>

                      <TableCell>{statusBadge(e)}</TableCell>

                      <TableCell className="hidden lg:table-cell text-xs text-slate-500">
                        {e.lastScan ? (
                          <>
                            <p>{fmtDateTime(e.lastScan.scanTime)}</p>
                            <p className={e.lastScan.result === "GRANTED" ? "text-emerald-600" : "text-rose-600"}>
                              {e.lastScan.result}
                            </p>
                          </>
                        ) : (
                          <span className="text-slate-300">noch nie</span>
                        )}
                      </TableCell>

                      <TableCell>
                        <div className="flex items-center gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="Verlauf"
                            onClick={(ev) => {
                              ev.stopPropagation();
                              setHistoryTarget({ id: e.id, name: fullName });
                            }}
                          >
                            <History className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="Bearbeiten"
                            onClick={(ev) => { ev.stopPropagation(); setEditingId(e.id); }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <EmployeeEditDialog
        target={editingId}
        areas={areas}
        devices={devices}
        onClose={() => setEditingId(null)}
        onSaved={() => { setEditingId(null); load(); }}
        onShowHistory={(id, name) => {
          setEditingId(null);
          setHistoryTarget({ id, name });
        }}
      />

      <EmployeeHistoryDialog
        employeeId={historyTarget?.id ?? null}
        employeeName={historyTarget?.name}
        onClose={() => setHistoryTarget(null)}
      />
    </>
  );
}
