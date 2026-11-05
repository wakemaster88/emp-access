"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/notice";
import { SearchInput } from "@/components/ui/search-input";
import {
  Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  IdCard, Plus, RefreshCw, Pencil, Clock, MapPin, Cpu, AlertTriangle,
  CheckCircle2, XCircle, ShieldOff, KeyRound, History, Loader2,
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

    // Status als weiche Pille in der Zustandsfarbe (docs/design-regeln.md, Abschnitte 3 und 14):
    // Inaktiv ist „aus“ (grau), Gesperrt und abgelaufener Vertrag brauchen Aufmerksamkeit (gelb).
    if (e.status === "INVALID") {
      return (
        <Badge variant="neutral">
          <XCircle className="h-3 w-3" /> Inaktiv
        </Badge>
      );
    }
    if (e.status === "PROTECTED") {
      return (
        <Badge variant="warning">
          <ShieldOff className="h-3 w-3" /> Gesperrt
        </Badge>
      );
    }
    if (isExpired) {
      return (
        <Badge variant="warning">
          <AlertTriangle className="h-3 w-3" /> Vertrag abgelaufen
        </Badge>
      );
    }
    return (
      <Badge variant="success">
        <CheckCircle2 className="h-3 w-3" /> Aktiv
      </Badge>
    );
  }

  return (
    <>
      {/* Tabelle läuft unten bis an den Kartenrand (docs/design-regeln.md, Abschnitt 17). */}
      <Card flush>
        {/* Kopf der Karte (docs/design-regeln.md, Abschnitt 13): Titel mit Zählern links, die Tasten
            oben rechts – auch auf dem Handy. Die Zähler rutschen dort unter den Titel. Der letzte
            EMP-Control-Abgleich steht ab md als Beschreibung darunter statt neben den Tasten, damit die
            Tastenspalte bei schmalem Inhalt (md mit offener Seitenleiste) nicht über die Karte wächst. */}
        <CardHeader>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <CardTitle className="flex items-center gap-2 tabular-nums">
              <IdCard className="h-4 w-4 text-primary" />
              Mitarbeiter ({filteredCounts.total})
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="success" className="tabular-nums">
                {filteredCounts.active} aktiv
              </Badge>
              {filteredCounts.expired > 0 && (
                <Badge variant="warning" className="tabular-nums">
                  {filteredCounts.expired} abgelaufen
                </Badge>
              )}
              {filteredCounts.blocked > 0 && (
                <Badge variant="warning" className="tabular-nums">
                  {filteredCounts.blocked} blockiert
                </Badge>
              )}
            </div>
          </div>
          {empControlLastSync && (
            <CardDescription className="hidden md:flex items-center gap-1 tabular-nums">
              <RefreshCw className="h-3 w-3" />
              EMP-Control: {fmtDateTime(empControlLastSync)}
            </CardDescription>
          )}
          <CardAction className="flex items-center gap-2">
            {/* Handy: „Neu laden“ nur als Symbol (44 px, Name bleibt für Screenreader), damit Titel und
                „+ Mitarbeiter“ in eine Zeile passen; ab sm mit Text wie bisher. */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => load()}
              disabled={loading}
              className="gap-1.5 max-sm:size-11"
            >
              <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              <span className="max-sm:sr-only">Neu laden</span>
            </Button>
            <Button size="sm" onClick={() => setEditingId("new")} className="gap-1.5 max-sm:h-11">
              <Plus className="h-4 w-4" /> Mitarbeiter
            </Button>
          </CardAction>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Handy: Suche in voller Breite, darunter beide Auswahlfelder in zwei gleich breiten Spalten
              (docs/design-regeln.md, Abschnitt 13); ab sm eine Zeile wie bisher. */}
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-row">
            <SearchInput
              placeholder="Name, RFID oder Email suchen…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              containerClassName="col-span-2 flex-1"
            />
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

          {error && <Notice tone="danger" compact title={error} />}
        </CardContent>

        {/* Bis an den Kartenrand; erste und letzte Spalte rücken auf den Innenabstand der Karte ein.
            Handy (326 px): Name mit Status als Nebenzeile und die beiden Tasten. Die Namensspalte
            nimmt dort den Rest und kürzt lange Namen, statt die Tabelle zu verbreitern; die
            Mindestbreite 220 px gilt erst ab sm (docs/design-regeln.md, Abschnitt 17). */}
        <Table edge>
          <TableHeader>
            <TableRow>
              <TableHead className="sm:min-w-[220px]">Mitarbeiter</TableHead>
              <TableHead className="hidden sm:table-cell w-[160px]">RFID / Email</TableHead>
              <TableHead className="hidden md:table-cell w-[200px]">Vertrag</TableHead>
              <TableHead className="hidden md:table-cell min-w-[200px]">Zugang</TableHead>
              {/* Auf dem Handy steht der Status in der Namensspalte, damit beide Tasten (44 px) ohne Wischen sichtbar sind. */}
              <TableHead className="hidden sm:table-cell w-[140px]">Status</TableHead>
              <TableHead className="hidden lg:table-cell w-[160px]">Letzte Aktivität</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && employees.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={7} className="py-10">
                  <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Lade Mitarbeiter…
                  </div>
                </TableCell>
              </TableRow>
            )}
            {!loading && employees.length === 0 && (
              <TableEmpty
                colSpan={7}
                className="p-0"
                compact={false}
                icon={IdCard}
                title="Keine Mitarbeiter gefunden"
                description="Per EMP-Control-Webhook oder manuell über „+ Mitarbeiter“ anlegen."
              />
            )}

            {employees.map((e) => {
              const fullName =
                [e.firstName, e.lastName].filter(Boolean).join(" ") || e.name;
              const initials = (e.firstName?.[0] ?? e.name[0] ?? "?") + (e.lastName?.[0] ?? "");
              return (
                <TableRow
                  key={e.id}
                  className="group cursor-pointer"
                  onClick={() => setEditingId(e.id)}
                >
                  <TableCell className="max-sm:w-full max-sm:max-w-0">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-9 w-9 rounded-full bg-primary/10 text-primary dark:text-foreground flex items-center justify-center text-xs font-bold shrink-0 overflow-hidden">
                        {e.profileImage ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={e.profileImage} alt="" className="h-full w-full object-cover" />
                        ) : (
                          initials.toUpperCase()
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {fullName}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {e.ticketTypeName ?? "Mitarbeiter"}
                          {e.hasSchedule && (
                            <span className="ml-1.5 inline-flex items-center gap-0.5 text-warning">
                              <Clock className="h-3 w-3" /> Plan
                            </span>
                          )}
                        </p>
                        <div className="mt-1 sm:hidden">{statusBadge(e)}</div>
                      </div>
                    </div>
                  </TableCell>

                  <TableCell className="hidden sm:table-cell">
                    <div className="space-y-0.5">
                      {e.rfidCode ? (
                        <p className="text-xs font-mono text-foreground/80 inline-flex items-center gap-1">
                          <KeyRound className="h-3 w-3 text-muted-foreground" />
                          {e.rfidCode}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">—</p>
                      )}
                      {e.email && (
                        <p className="text-[11px] text-muted-foreground truncate max-w-[160px]">{e.email}</p>
                      )}
                    </div>
                  </TableCell>

                  <TableCell className="hidden md:table-cell">
                    <div className="text-xs text-muted-foreground tabular-nums">
                      {e.startDate || e.endDate ? (
                        <>
                          <p>{e.startDate ? fmtDate(e.startDate) : "—"} <span>bis</span></p>
                          <p>{e.endDate ? fmtDate(e.endDate) : "unbefristet"}</p>
                        </>
                      ) : (
                        <p>unbefristet</p>
                      )}
                    </div>
                  </TableCell>

                  <TableCell className="hidden md:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {e.areas.length === 0 && e.directDevices.length === 0 && (
                        <span className="text-xs text-muted-foreground">Kein Zugang</span>
                      )}
                      {e.areas.slice(0, 3).map((a) => (
                        <Badge key={a.id} variant="secondary">
                          <MapPin className="h-2.5 w-2.5" /> {a.name}
                        </Badge>
                      ))}
                      {e.areas.length > 3 && (
                        <Badge variant="neutral" className="tabular-nums">+{e.areas.length - 3}</Badge>
                      )}
                      {/* Direkt zugewiesene Geräte neutral; das Chip-Symbol unterscheidet sie von Bereichen. */}
                      {e.directDevices.slice(0, 2).map((d) => (
                        <Badge key={d.id} variant="secondary">
                          <Cpu className="h-2.5 w-2.5" /> {d.name}
                        </Badge>
                      ))}
                      {e.directDevices.length > 2 && (
                        <Badge variant="neutral" className="tabular-nums">+{e.directDevices.length - 2}</Badge>
                      )}
                    </div>
                  </TableCell>

                  <TableCell className="hidden sm:table-cell">{statusBadge(e)}</TableCell>

                  <TableCell className="hidden lg:table-cell text-xs text-muted-foreground tabular-nums">
                    {e.lastScan ? (
                      <>
                        <p>{fmtDateTime(e.lastScan.scanTime)}</p>
                        <p className={e.lastScan.result === "GRANTED" ? "text-success" : "text-destructive"}>
                          {e.lastScan.result}
                        </p>
                      </>
                    ) : (
                      <span>noch nie</span>
                    )}
                  </TableCell>

                  <TableCell>
                    <div className="flex items-center gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="max-sm:size-11"
                        title="Verlauf"
                        aria-label="Verlauf"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setHistoryTarget({ id: e.id, name: fullName });
                        }}
                      >
                        <History className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="max-sm:size-11"
                        title="Bearbeiten"
                        aria-label="Bearbeiten"
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
