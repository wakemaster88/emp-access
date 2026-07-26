"use client";

import { useMemo, useState, Fragment } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Radar, Loader2, Plus, Server, MonitorSmartphone, Cpu, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { findAreaForIp, findVlanForIp, ipToInt } from "@/lib/ip";
import {
  CLIENT_TYPES,
  areaGroupSortKey,
  vlanColor,
  vlanGroupSortKey,
  type AreaRow,
  type VlanRow,
} from "@/components/network/network-types";

export interface DiscoveredRow {
  id: number;
  macAddress: string;
  ipAddress: string | null;
  iface: string | null;
  hostname: string | null;
  vendor: string | null;
  openPorts: number[];
  /// Fruehere IP-Adressen (neueste zuerst), gepflegt vom Scan-Endpoint.
  ipHistory: { ip: string; seenUntil: string }[];
  deviceType: string | null;
  responseMs: number | null;
  reachable: boolean;
  hubName: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  /// Automatischer Abgleich gegen verwalteten Bestand: infra = Switch/Router/
  /// AP, client = Netzwerk-Client, device = IoT-/Scanner-Geraet (per IP).
  match: { kind: "infra" | "client" | "device"; name: string } | null;
}

/** Bekannte Ports auf sprechende Kurznamen abbilden. */
const PORT_LABELS: Record<number, string> = {
  21: "FTP", 22: "SSH", 23: "Telnet", 53: "DNS", 80: "HTTP", 139: "SMB",
  143: "IMAP", 443: "HTTPS", 445: "SMB", 515: "LPD", 548: "AFP", 554: "RTSP",
  631: "IPP", 993: "IMAPS", 1883: "MQTT", 3389: "RDP", 5000: "UPnP",
  5900: "VNC", 8080: "HTTP-Alt", 8443: "HTTPS-Alt", 9100: "Druck", 32400: "Plex",
  62078: "iOS-Sync",
};

function portLabel(p: number): string {
  return PORT_LABELS[p] ? `${p} (${PORT_LABELS[p]})` : String(p);
}

/** Heuristik-Geraetetyp des Scanners auf einen NetworkClient-Typ mappen. */
function mapType(deviceType: string | null): string {
  switch (deviceType) {
    case "Drucker": return "PRINTER";
    case "Kamera": return "CAMERA";
    case "NAS/Server":
    case "Medienserver": return "NAS";
    case "iPhone/iPad": return "PHONE";
    case "Windows-PC":
    case "Server/PC":
    case "Raspberry Pi": return "PC";
    case "IoT-Gerät": return "IOT";
    default: return "OTHER";
  }
}

function formatSeen(iso: string): string {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (diffMin < 1) return "gerade eben";
  if (diffMin < 60) return `vor ${diffMin} min`;
  if (diffMin < 60 * 24) return `vor ${Math.floor(diffMin / 60)} h`;
  return new Date(iso).toLocaleDateString("de-DE");
}

type Filter = "all" | "unknown" | "known";

export function DiscoveredTab({
  devices,
  vlans,
  areas,
}: {
  devices: DiscoveredRow[];
  vlans: VlanRow[];
  areas: AreaRow[];
}) {
  const router = useRouter();
  // "Aktiv" = im letzten Scan-Fenster gesehen (15 min Toleranz).
  const activeCutoff = Date.now() - 15 * 60_000;

  const [filter, setFilter] = useState<Filter>("all");
  const [adopting, setAdopting] = useState<DiscoveredRow | null>(null);
  const [form, setForm] = useState({ name: "", type: "OTHER", areaId: "none" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const unknownCount = useMemo(() => devices.filter((d) => !d.match).length, [devices]);

  // Doppelbelegung: dieselbe IP bei mehreren aktiven MACs - deutet auf einen
  // IP-Konflikt (oder einen veralteten ARP-Eintrag kurz nach DHCP-Wechsel) hin.
  const duplicateIps = useMemo(() => {
    const byIp = new Map<string, number>();
    for (const d of devices) {
      if (!d.ipAddress || new Date(d.lastSeenAt).getTime() <= activeCutoff) continue;
      byIp.set(d.ipAddress, (byIp.get(d.ipAddress) ?? 0) + 1);
    }
    return new Set([...byIp.entries()].filter(([, n]) => n > 1).map(([ip]) => ip));
  }, [devices, activeCutoff]);

  const filtered = useMemo(
    () =>
      devices
        .filter((d) => {
          if (filter === "unknown") return !d.match;
          if (filter === "known") return !!d.match;
          return true;
        })
        .sort((a, b) => {
          const ai = a.ipAddress ? ipToInt(a.ipAddress) : null;
          const bi = b.ipAddress ? ipToInt(b.ipAddress) : null;
          if (ai !== null && bi !== null) return ai - bi;
          if (ai !== null) return -1;
          if (bi !== null) return 1;
          return a.macAddress.localeCompare(b.macAddress);
        }),
    [devices, filter]
  );

  const vlanGroups = useMemo(() => {
    type AreaGroup = {
      meta: { areaId: number | null; name: string; sortOrder: number | null };
      items: DiscoveredRow[];
    };
    type VlanGroup = {
      meta: { vlanDbId: number | null; vlanId: number | null; name: string; subnet: string | null };
      areas: AreaGroup[];
      showAreas: boolean;
    };

    const byVlan = new Map<
      string,
      { meta: VlanGroup["meta"]; items: { device: DiscoveredRow; areaId: number | null; areaName: string; areaSort: number | null }[] }
    >();

    for (const d of filtered) {
      const v = findVlanForIp(d.ipAddress, vlans);
      const a = findAreaForIp(d.ipAddress, areas);
      const key = v ? `v-${v.id}` : "none";
      let g = byVlan.get(key);
      if (!g) {
        g = {
          meta: {
            vlanDbId: v?.id ?? null,
            vlanId: v?.vlanId ?? null,
            name: v?.name ?? "Ohne VLAN",
            subnet: v?.subnet ?? null,
          },
          items: [],
        };
        byVlan.set(key, g);
      }
      g.items.push({
        device: d,
        areaId: a?.id ?? null,
        areaName: a?.name ?? "Ohne Bereich",
        areaSort: a?.sortOrder ?? null,
      });
    }

    return [...byVlan.values()]
      .sort((a, b) => vlanGroupSortKey(a.meta.vlanId) - vlanGroupSortKey(b.meta.vlanId))
      .map((g) => {
        const byArea = new Map<string, AreaGroup>();
        for (const row of g.items) {
          const key = row.areaId != null ? `a-${row.areaId}` : "none";
          let ag = byArea.get(key);
          if (!ag) {
            ag = {
              meta: { areaId: row.areaId, name: row.areaName, sortOrder: row.areaSort },
              items: [],
            };
            byArea.set(key, ag);
          }
          ag.items.push(row.device);
        }
        const areaGroups = [...byArea.values()].sort(
          (a, b) => areaGroupSortKey(a.meta.sortOrder) - areaGroupSortKey(b.meta.sortOrder)
        );
        const showAreas = areas.length > 0 && (
          areaGroups.length > 1 || areaGroups.some((ag) => ag.meta.areaId != null)
        );
        return { meta: g.meta, areas: areaGroups, showAreas };
      });
  }, [filtered, vlans, areas]);

  function openAdopt(d: DiscoveredRow) {
    setAdopting(d);
    const suggested = findAreaForIp(d.ipAddress, areas);
    setForm({
      // Hostname (ohne Domain-Suffix) als Namensvorschlag.
      name: d.hostname ? d.hostname.split(".")[0] : "",
      type: mapType(d.deviceType),
      areaId: suggested ? String(suggested.id) : "none",
    });
    setError("");
  }

  async function handleAdopt(e: React.FormEvent) {
    e.preventDefault();
    if (!adopting || !form.name.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/network/discovered/${adopting.id}/adopt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          type: form.type,
          areaId: form.areaId === "none" ? null : Number(form.areaId),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Fehler beim Übernehmen");
      } else {
        setAdopting(null);
        router.refresh();
      }
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setSaving(false);
    }
  }

  const FILTERS: { value: Filter; label: string }[] = [
    { value: "all", label: `Alle (${devices.length})` },
    { value: "unknown", label: `Unbekannt (${unknownCount})` },
    { value: "known", label: `Zugeordnet (${devices.length - unknownCount})` },
  ];

  return (
    <Card className="border-slate-200 dark:border-slate-800">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4">
        <div>
          <CardTitle className="text-base sm:text-xl flex items-center gap-2">
            <Radar className="h-5 w-5 text-violet-500" />
            Vom Hub entdeckte Geräte ({devices.length})
          </CardTitle>
          <p className="text-xs text-slate-500 mt-1">
            Der lokale Hub scannt das Netz aktiv (Ping-Sweep + Portscan) und
            erkennt Hostname, Hersteller, offene Ports und Gerätetyp.
            MAC-Abgleich gegen Switches, APs und erfasste Geräte. Gruppiert nach VLAN → Bereich.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-1">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                filter === f.value
                  ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm"
                  : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="p-0 sm:px-6 sm:pb-6 space-y-3">
        {duplicateIps.size > 0 && (
          <div className="mx-4 sm:mx-0 flex items-start gap-2 rounded-lg border border-rose-300 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 px-4 py-3 text-sm text-rose-800 dark:text-rose-300">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              <strong>IP-Doppelbelegung erkannt:</strong>{" "}
              {[...duplicateIps].sort((a, b) => (ipToInt(a) ?? 0) - (ipToInt(b) ?? 0)).join(", ")}{" "}
              wird von mehreren Geräten gleichzeitig verwendet. Feste IPs und DHCP-Bereich prüfen.
            </span>
          </div>
        )}
        {filtered.length === 0 ? (
          <p className="text-sm text-slate-500 px-6 pb-6 sm:px-0">
            {devices.length === 0
              ? "Noch keine Geräte gemeldet. Läuft der Hub und ist das Modul „auto-scan“ aktiv?"
              : "Keine Einträge in diesem Filter."}
          </p>
        ) : (
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-200 dark:border-slate-700 hover:bg-transparent bg-slate-50/80 dark:bg-slate-900/50">
                  <TableHead>Status</TableHead>
                  <TableHead className="min-w-[120px]">IP-Adresse</TableHead>
                  <TableHead className="min-w-[160px]">Hostname</TableHead>
                  <TableHead className="hidden md:table-cell">Hersteller</TableHead>
                  <TableHead className="hidden xl:table-cell">Typ</TableHead>
                  <TableHead className="hidden md:table-cell min-w-[160px]">Offene Ports</TableHead>
                  <TableHead className="hidden sm:table-cell min-w-[150px]">MAC-Adresse</TableHead>
                  <TableHead className="min-w-[160px]">Zuordnung</TableHead>
                  <TableHead className="hidden xl:table-cell">Ping</TableHead>
                  <TableHead className="hidden lg:table-cell">Zuletzt gesehen</TableHead>
                  <TableHead className="w-28" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {vlanGroups.map((group) => {
                  const vlanCount = group.areas.reduce((n, a) => n + a.items.length, 0);
                  return (
                    <Fragment key={group.meta.vlanDbId ?? "none"}>
                      <TableRow className="border-slate-200 dark:border-slate-700 hover:bg-transparent bg-slate-100/80 dark:bg-slate-900/80">
                        <TableCell colSpan={11} className="py-2">
                          <div className="flex flex-wrap items-center gap-2">
                            {group.meta.vlanDbId != null ? (
                              <Badge className={cn("text-xs font-mono", vlanColor(group.meta.vlanDbId))}>
                                VLAN {group.meta.vlanId} · {group.meta.name}
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="text-xs">Ohne VLAN</Badge>
                            )}
                            {group.meta.subnet && (
                              <span className="text-[11px] font-mono text-slate-400">{group.meta.subnet}</span>
                            )}
                            <span className="text-[11px] text-slate-400">{vlanCount} Geräte</span>
                          </div>
                        </TableCell>
                      </TableRow>
                      {group.areas.map((areaGroup) => (
                        <Fragment key={`${group.meta.vlanDbId ?? "none"}-${areaGroup.meta.areaId ?? "none"}`}>
                          {group.showAreas && (
                            <TableRow className="border-slate-200 dark:border-slate-700 hover:bg-transparent bg-slate-50/90 dark:bg-slate-900/40">
                              <TableCell colSpan={11} className="py-1.5 pl-6">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                                    {areaGroup.meta.name}
                                  </span>
                                  <span className="text-[11px] text-slate-400">
                                    {areaGroup.items.length} Geräte
                                  </span>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                          {areaGroup.items.map((d) => {
                            const active = new Date(d.lastSeenAt).getTime() > activeCutoff;
                            return (
                              <TableRow key={d.id} className="border-slate-200 dark:border-slate-700">
                                <TableCell>
                                  {active ? (
                                    <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 gap-1 text-xs h-5">
                                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> aktiv
                                    </Badge>
                                  ) : (
                                    <Badge variant="secondary" className="text-slate-400 gap-1 text-xs h-5">
                                      <span className="h-1.5 w-1.5 rounded-full bg-slate-400" /> inaktiv
                                    </Badge>
                                  )}
                                </TableCell>
                                <TableCell className="font-mono text-sm">
                                  {d.ipAddress ? (
                                    <span
                                      className={cn(
                                        "inline-flex items-center gap-1",
                                        duplicateIps.has(d.ipAddress) && "text-rose-600 dark:text-rose-400 font-semibold"
                                      )}
                                    >
                                      {d.ipAddress}
                                      {duplicateIps.has(d.ipAddress) && (
                                        <AlertTriangle className="h-3.5 w-3.5" aria-label="IP-Doppelbelegung" />
                                      )}
                                    </span>
                                  ) : (
                                    "–"
                                  )}
                                  {d.ipHistory.length > 0 && (
                                    <span
                                      className="block text-[11px] text-slate-400 font-normal"
                                      title={d.ipHistory
                                        .map((h) => `${h.ip} (bis ${new Date(h.seenUntil).toLocaleDateString("de-DE")})`)
                                        .join("\n")}
                                    >
                                      vorher: {d.ipHistory[0].ip}
                                      {d.ipHistory.length > 1 && ` +${d.ipHistory.length - 1}`}
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell className="text-sm">
                                  {d.hostname ? (
                                    <span className="text-slate-700 dark:text-slate-300">{d.hostname}</span>
                                  ) : (
                                    <span className="text-slate-400">–</span>
                                  )}
                                </TableCell>
                                <TableCell className="hidden md:table-cell text-sm text-slate-500">
                                  {d.vendor ?? <span className="text-slate-300">–</span>}
                                </TableCell>
                                <TableCell className="hidden xl:table-cell">
                                  {d.deviceType ? (
                                    <Badge variant="secondary" className="text-xs h-5 font-normal">{d.deviceType}</Badge>
                                  ) : (
                                    <span className="text-slate-400 text-sm">–</span>
                                  )}
                                </TableCell>
                                <TableCell className="hidden md:table-cell">
                                  {d.openPorts.length > 0 ? (
                                    <div className="flex flex-wrap gap-1">
                                      {d.openPorts.slice(0, 6).map((p) => (
                                        <span
                                          key={p}
                                          className="inline-block rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[11px] font-mono text-slate-600 dark:text-slate-300"
                                          title={portLabel(p)}
                                        >
                                          {PORT_LABELS[p] ?? p}
                                        </span>
                                      ))}
                                      {d.openPorts.length > 6 && (
                                        <span className="text-[11px] text-slate-400">+{d.openPorts.length - 6}</span>
                                      )}
                                    </div>
                                  ) : (
                                    <span className="text-slate-400 text-sm">–</span>
                                  )}
                                </TableCell>
                                <TableCell className="hidden sm:table-cell font-mono text-xs text-slate-500">{d.macAddress}</TableCell>
                                <TableCell>
                                  {d.match ? (
                                    <span className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                                      {d.match.kind === "infra"
                                        ? <Server className="h-3.5 w-3.5 text-indigo-500" />
                                        : d.match.kind === "device"
                                          ? <Cpu className="h-3.5 w-3.5 text-violet-500" />
                                          : <MonitorSmartphone className="h-3.5 w-3.5 text-emerald-500" />}
                                      {d.match.name}
                                    </span>
                                  ) : (
                                    <Badge variant="secondary" className="text-xs text-slate-400">unbekannt</Badge>
                                  )}
                                </TableCell>
                                <TableCell className="hidden xl:table-cell text-sm text-slate-500">
                                  {d.responseMs != null ? `${d.responseMs} ms` : "–"}
                                </TableCell>
                                <TableCell className="hidden lg:table-cell text-sm text-slate-500">
                                  {formatSeen(d.lastSeenAt)}
                                </TableCell>
                                <TableCell>
                                  {!d.match && (
                                    <div className="flex justify-end">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-7 text-xs gap-1"
                                        onClick={() => openAdopt(d)}
                                      >
                                        <Plus className="h-3 w-3" />
                                        Übernehmen
                                      </Button>
                                    </div>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </Fragment>
                      ))}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {/* Übernehmen-Dialog */}
      <Dialog open={!!adopting} onOpenChange={(o) => { if (!o) setAdopting(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Gerät übernehmen</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAdopt} className="space-y-4">
            <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 p-3 text-xs font-mono text-slate-500 space-y-0.5">
              <p>IP: {adopting?.ipAddress ?? "–"}</p>
              <p>MAC: {adopting?.macAddress}</p>
              {adopting?.hostname && <p>Hostname: {adopting.hostname}</p>}
              {adopting?.vendor && <p>Hersteller: {adopting.vendor}</p>}
              {adopting?.deviceType && <p>Erkannt als: {adopting.deviceType}</p>}
              {adopting && adopting.openPorts.length > 0 && (
                <p>Offene Ports: {adopting.openPorts.join(", ")}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Name <span className="text-rose-500">*</span></Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="z.B. Kassen-PC Shop"
                required
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>Typ</Label>
              <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CLIENT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {areas.length > 0 && (
              <div className="space-y-1.5">
                <Label>Bereich</Label>
                <Select value={form.areaId} onValueChange={(v) => setForm((f) => ({ ...f, areaId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Automatisch" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Automatisch aus IP</SelectItem>
                    {areas.map((a) => (
                      <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {error && (
              <p className="text-sm text-rose-600 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 rounded-lg">{error}</p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setAdopting(null)} disabled={saving}>
                Abbrechen
              </Button>
              <Button
                type="submit"
                disabled={saving || !form.name.trim()}
                className="bg-indigo-600 hover:bg-indigo-700 min-w-28"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Übernehmen"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
