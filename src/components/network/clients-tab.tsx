"use client";

import { useMemo, useState, Fragment } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Plus, Loader2, Pencil, Trash2, MonitorSmartphone, Monitor as MonitorIcon,
  Printer, Camera, HardDrive, Phone, Cpu, Laptop, EthernetPort, Link2,
  Radar, AlertTriangle, RefreshCw, BadgeCheck, Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { findAreaForIp, findVlanForIp, ipToInt } from "@/lib/ip";
import {
  CLIENT_TYPES,
  ONLINE_THRESHOLD_MS,
  areaGroupSortKey,
  scanOnline,
  vlanColor,
  vlanGroupSortKey,
  type AreaRow,
  type ClientRow,
  type DiscoveredRow,
  type IotDeviceOption,
  type PortOption,
  type VlanRow,
} from "@/components/network/network-types";

function StatusBadge({ online }: { online: boolean | null }) {
  if (online === true) {
    return (
      <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 gap-1 text-[11px] h-5 px-1.5 font-medium">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Online
      </Badge>
    );
  }
  if (online === false) {
    return (
      <Badge variant="secondary" className="text-slate-500 gap-1 text-[11px] h-5 px-1.5 font-medium">
        <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
        Offline
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-slate-400 gap-1 text-[11px] h-5 px-1.5 font-normal">
      ?
    </Badge>
  );
}

/** IP mit Schloss bei fester IP; Verified-Haken wenn Scan MAC+IP bestätigt. */
function IpCell({
  ip,
  verified,
  isStatic,
  conflict,
}: {
  ip: string | null;
  verified: boolean;
  isStatic?: boolean;
  conflict?: boolean;
}) {
  if (!ip) return <span className="text-slate-300">–</span>;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-mono text-xs",
        conflict ? "text-rose-600 dark:text-rose-400 font-semibold" : "text-slate-500"
      )}
    >
      {isStatic && (
        <Lock
          className="h-3 w-3 text-amber-500 shrink-0"
          aria-label="Feste IP"
        />
      )}
      {ip}
      {verified && (
        <BadgeCheck
          className="h-3.5 w-3.5 text-emerald-500 shrink-0"
          aria-label="IP vom Scan bestätigt"
        />
      )}
    </span>
  );
}

const TYPE_ICON: Record<string, React.ElementType> = {
  PC: Laptop,
  PRINTER: Printer,
  CAMERA: Camera,
  NAS: HardDrive,
  PHONE: Phone,
  IOT: Cpu,
  MONITOR: MonitorIcon,
  OTHER: MonitorSmartphone,
};

const EMPTY = {
  name: "",
  type: "OTHER",
  ipAddress: "",
  macAddress: "",
  isStatic: false,
  deviceId: "none",
  portId: "none",
  vlanId: "none",
  areaId: "none",
  notes: "",
};

type ListFilter = "all" | "managed" | "unknown";

function mapDiscoveredType(deviceType: string | null): string {
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

function rowIp(row: {
  kind: string;
  client?: ClientRow;
  device?: IotDeviceOption;
  discovered?: DiscoveredRow;
}): string {
  if (row.kind === "client" && row.client) {
    return row.client.ipAddress || row.client.device?.ipAddress || "";
  }
  if (row.kind === "iot" && row.device) return row.device.ipAddress || "";
  if (row.kind === "discovered" && row.discovered) return row.discovered.ipAddress || "";
  return "";
}

interface ClientsTabProps {
  clients: ClientRow[];
  iotDevices: IotDeviceOption[];
  vlans: VlanRow[];
  areas: AreaRow[];
  ports: PortOption[];
  discovered: DiscoveredRow[];
}

export function ClientsTab({
  clients,
  iotDevices,
  vlans,
  areas,
  ports,
  discovered,
}: ClientsTabProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ClientRow | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<ListFilter>("all");

  const [adopting, setAdopting] = useState<DiscoveredRow | null>(null);
  const [adoptForm, setAdoptForm] = useState({ name: "", type: "OTHER", areaId: "none" });
  const [adoptSaving, setAdoptSaving] = useState(false);
  const [adoptError, setAdoptError] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState("");

  const activeCutoff = Date.now() - 15 * 60_000;

  async function triggerScan() {
    if (scanning) return;
    setScanning(true);
    setScanMsg("Scan wird gestartet …");
    try {
      const res = await fetch("/api/network/scan", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setScanMsg(data.error ?? "Scan konnte nicht gestartet werden");
        setScanning(false);
        return;
      }
      const taskId = data.taskId as number;
      setScanMsg(data.reused ? "Scan läuft bereits …" : "Hub scannt das Netz …");

      const deadline = Date.now() + 180_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000));
        const st = await fetch(`/api/network/scan?taskId=${taskId}`);
        const body = await st.json().catch(() => ({}));
        if (!st.ok) continue;
        if (body.status === "DONE") {
          setScanMsg(
            typeof body.deviceCount === "number"
              ? `Scan fertig · ${body.deviceCount} Geräte`
              : "Scan fertig"
          );
          router.refresh();
          setScanning(false);
          setTimeout(() => setScanMsg(""), 4000);
          return;
        }
        if (body.status === "FAILED") {
          const err = String(body.error ?? "");
          setScanMsg(
            /arp fehlgeschlagen/i.test(err)
              ? "Hub-Software veraltet – bitte auf dem iMac einmal aktualisieren: hub/install/update.sh"
              : (body.error ?? "Scan fehlgeschlagen")
          );
          setScanning(false);
          return;
        }
        setScanMsg(body.status === "RUNNING" ? "Hub scannt …" : "Warte auf Hub …");
      }
      setScanMsg("Timeout – Seite später neu laden");
      setScanning(false);
    } catch {
      setScanMsg("Netzwerkfehler");
      setScanning(false);
    }
  }

  // IoT-Geraete, die noch nicht als NetworkClient erfasst sind.
  const linkedDeviceIds = useMemo(
    () => new Set(clients.map((c) => c.device?.id).filter(Boolean)),
    [clients]
  );
  const unlinkedIot = iotDevices.filter((d) => d.isActive && !linkedDeviceIds.has(d.id));

  // Nur unbekannte Scan-Funde (bekannte sind schon als Client/Infra sichtbar).
  const unknownDiscovered = useMemo(
    () => discovered.filter((d) => !d.match),
    [discovered]
  );

  /// MAC → letzter Scan-Treffer (fuer Online + IP-Verified).
  const scanByMac = useMemo(() => {
    const map = new Map<string, DiscoveredRow>();
    for (const d of discovered) {
      map.set(d.macAddress.toUpperCase(), d);
    }
    return map;
  }, [discovered]);

  function ipVerified(mac: string | null | undefined, ip: string | null | undefined): boolean {
    if (!mac || !ip) return false;
    const hit = scanByMac.get(mac.toUpperCase());
    if (!hit?.ipAddress) return false;
    if (hit.ipAddress !== ip) return false;
    return Date.now() - new Date(hit.lastSeenAt).getTime() < ONLINE_THRESHOLD_MS;
  }

  const duplicateIps = useMemo(() => {
    const byIp = new Map<string, number>();
    for (const d of discovered) {
      if (!d.ipAddress || new Date(d.lastSeenAt).getTime() <= activeCutoff) continue;
      byIp.set(d.ipAddress, (byIp.get(d.ipAddress) ?? 0) + 1);
    }
    return new Set([...byIp.entries()].filter(([, n]) => n > 1).map(([ip]) => ip));
  }, [discovered, activeCutoff]);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((p) => ({ ...p, [key]: value }));
  }

  function openAdd(prefillDevice?: IotDeviceOption) {
    setEditing(null);
    setForm({
      ...EMPTY,
      ...(prefillDevice
        ? {
            name: prefillDevice.name,
            type: "IOT",
            ipAddress: prefillDevice.ipAddress ?? "",
            deviceId: String(prefillDevice.id),
          }
        : {}),
    });
    setError("");
    setOpen(true);
  }

  function openEdit(c: ClientRow) {
    setEditing(c);
    setForm({
      name: c.name,
      type: c.type,
      ipAddress: c.ipAddress ?? "",
      macAddress: c.macAddress ?? "",
      isStatic: c.isStatic,
      deviceId: c.device ? String(c.device.id) : "none",
      portId: c.port ? String(c.port.id) : "none",
      vlanId: c.vlan ? String(c.vlan.id) : "none",
      areaId: c.area ? String(c.area.id) : "none",
      notes: c.notes ?? "",
    });
    setError("");
    setOpen(true);
  }

  function openAdopt(d: DiscoveredRow) {
    setAdopting(d);
    const suggested = findAreaForIp(d.ipAddress, areas);
    setAdoptForm({
      name: d.hostname ? d.hostname.split(".")[0] : "",
      type: mapDiscoveredType(d.deviceType),
      areaId: suggested ? String(suggested.id) : "none",
    });
    setAdoptError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    setError("");

    try {
      const res = await fetch(
        editing ? `/api/network/clients/${editing.id}` : "/api/network/clients",
        {
          method: editing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name.trim(),
            type: form.type,
            ipAddress: form.ipAddress,
            macAddress: form.macAddress,
            isStatic: form.isStatic,
            deviceId: form.deviceId === "none" ? null : Number(form.deviceId),
            portId: form.portId === "none" ? null : Number(form.portId),
            vlanId: form.vlanId === "none" ? null : Number(form.vlanId),
            areaId: form.areaId === "none" ? null : Number(form.areaId),
            notes: form.notes,
          }),
        }
      );
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Fehler beim Speichern");
      } else {
        setOpen(false);
        router.refresh();
      }
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setSaving(false);
    }
  }

  async function handleAdopt(e: React.FormEvent) {
    e.preventDefault();
    if (!adopting || !adoptForm.name.trim()) return;
    setAdoptSaving(true);
    setAdoptError("");
    try {
      const res = await fetch(`/api/network/discovered/${adopting.id}/adopt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: adoptForm.name.trim(),
          type: adoptForm.type,
          areaId: adoptForm.areaId === "none" ? null : Number(adoptForm.areaId),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setAdoptError(data.error ?? "Fehler beim Übernehmen");
      } else {
        setAdopting(null);
        router.refresh();
      }
    } catch {
      setAdoptError("Netzwerkfehler");
    } finally {
      setAdoptSaving(false);
    }
  }

  async function handleDelete(c: ClientRow) {
    if (!confirm(`"${c.name}" aus der Netzwerk-Verwaltung entfernen?`)) return;
    setDeletingId(c.id);
    try {
      const res = await fetch(`/api/network/clients/${c.id}`, { method: "DELETE" });
      if (res.ok) router.refresh();
    } finally {
      setDeletingId(null);
    }
  }

  const selectablePorts = ports.filter(
    (p) => !p.occupied || (editing?.port && p.id === editing.port.id)
  );

  const fiveMinAgo = Date.now() - 5 * 60 * 1000;
  const managedCount = clients.length + unlinkedIot.length;

  type Row =
    | {
        kind: "client";
        client: ClientRow;
        vlanDbId: number | null;
        vlanId: number | null;
        vlanName: string;
        subnet: string | null;
        areaId: number | null;
        areaName: string;
        areaSort: number | null;
      }
    | {
        kind: "iot";
        device: IotDeviceOption;
        vlanDbId: number | null;
        vlanId: number | null;
        vlanName: string;
        subnet: string | null;
        areaId: number | null;
        areaName: string;
        areaSort: number | null;
      }
    | {
        kind: "discovered";
        discovered: DiscoveredRow;
        vlanDbId: number | null;
        vlanId: number | null;
        vlanName: string;
        subnet: string | null;
        areaId: number | null;
        areaName: string;
        areaSort: number | null;
      };

  const vlanGroups = useMemo(() => {
    const rows: Row[] = [];

    if (filter !== "unknown") {
      for (const c of clients) {
        const ip = c.ipAddress || c.device?.ipAddress || null;
        const derived = c.vlan ? null : findVlanForIp(ip, vlans);
        const v = c.vlan
          ? vlans.find((x) => x.id === c.vlan!.id) ?? null
          : derived;
        const derivedArea = c.area ? null : findAreaForIp(ip, areas);
        const area = c.area ?? (derivedArea
          ? { id: derivedArea.id, name: derivedArea.name, sortOrder: derivedArea.sortOrder, vlanId: derivedArea.vlanId }
          : null);
        rows.push({
          kind: "client",
          client: c,
          vlanDbId: c.vlan?.id ?? derived?.id ?? null,
          vlanId: c.vlan?.vlanId ?? derived?.vlanId ?? null,
          vlanName: c.vlan?.name ?? derived?.name ?? "Ohne VLAN",
          subnet: v?.subnet ?? null,
          areaId: area?.id ?? null,
          areaName: area?.name ?? "Ohne Bereich",
          areaSort: area?.sortOrder ?? null,
        });
      }
      for (const d of unlinkedIot) {
        const derived = findVlanForIp(d.ipAddress, vlans);
        const derivedArea = findAreaForIp(d.ipAddress, areas);
        rows.push({
          kind: "iot",
          device: d,
          vlanDbId: derived?.id ?? null,
          vlanId: derived?.vlanId ?? null,
          vlanName: derived?.name ?? "Ohne VLAN",
          subnet: derived?.subnet ?? null,
          areaId: derivedArea?.id ?? null,
          areaName: derivedArea?.name ?? "Ohne Bereich",
          areaSort: derivedArea?.sortOrder ?? null,
        });
      }
    }

    if (filter !== "managed") {
      for (const d of unknownDiscovered) {
        const derived = findVlanForIp(d.ipAddress, vlans);
        const derivedArea = findAreaForIp(d.ipAddress, areas);
        rows.push({
          kind: "discovered",
          discovered: d,
          vlanDbId: derived?.id ?? null,
          vlanId: derived?.vlanId ?? null,
          vlanName: derived?.name ?? "Ohne VLAN",
          subnet: derived?.subnet ?? null,
          areaId: derivedArea?.id ?? null,
          areaName: derivedArea?.name ?? "Ohne Bereich",
          areaSort: derivedArea?.sortOrder ?? null,
        });
      }
    }

    type AreaGroup = {
      meta: { areaId: number | null; name: string; sortOrder: number | null };
      items: Row[];
    };
    type VlanGroup = {
      meta: { vlanDbId: number | null; vlanId: number | null; name: string; subnet: string | null };
      areas: AreaGroup[];
      showAreas: boolean;
    };

    const byVlan = new Map<string, { meta: VlanGroup["meta"]; items: Row[] }>();
    for (const row of rows) {
      const key = row.vlanDbId != null ? `v-${row.vlanDbId}` : "none";
      let g = byVlan.get(key);
      if (!g) {
        g = {
          meta: {
            vlanDbId: row.vlanDbId,
            vlanId: row.vlanId,
            name: row.vlanName,
            subnet: row.subnet,
          },
          items: [],
        };
        byVlan.set(key, g);
      }
      g.items.push(row);
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
          ag.items.push(row);
        }
        const areaGroups = [...byArea.values()].sort(
          (a, b) => areaGroupSortKey(a.meta.sortOrder) - areaGroupSortKey(b.meta.sortOrder)
        );
        for (const ag of areaGroups) {
          ag.items.sort((a, b) => {
            const ai = ipToInt(rowIp(a)) ?? Number.MAX_SAFE_INTEGER;
            const bi = ipToInt(rowIp(b)) ?? Number.MAX_SAFE_INTEGER;
            return ai - bi;
          });
        }
        const showAreas = areas.length > 0 && (
          areaGroups.length > 1 || areaGroups.some((ag) => ag.meta.areaId != null)
        );
        return { meta: g.meta, areas: areaGroups, showAreas };
      });
  }, [clients, unlinkedIot, unknownDiscovered, vlans, areas, filter]);

  const visibleCount = vlanGroups.reduce(
    (n, g) => n + g.areas.reduce((m, a) => m + a.items.length, 0),
    0
  );

  const FILTERS: { value: ListFilter; label: string }[] = [
    { value: "all", label: `Alle (${managedCount + unknownDiscovered.length})` },
    { value: "managed", label: `Verwaltet (${managedCount})` },
    { value: "unknown", label: `Neu vom Scan (${unknownDiscovered.length})` },
  ];

  return (
    <Card className="border-slate-200 dark:border-slate-800">
      <CardHeader className="flex flex-col gap-3 pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <CardTitle className="text-base sm:text-xl">
              Geräte im Netzwerk ({visibleCount})
            </CardTitle>
            <p className="text-xs text-slate-500 mt-1">
              Verwaltete Geräte und unbekannte Hub-Funde, gruppiert nach VLAN → Bereich.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
            <Button
              type="button"
              variant="outline"
              onClick={triggerScan}
              disabled={scanning}
              className="gap-2"
            >
              {scanning
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <RefreshCw className="h-4 w-4" />}
              {scanning ? "Scannt …" : "Netzwerk scannen"}
            </Button>
            <Button onClick={() => openAdd()} className="bg-indigo-600 hover:bg-indigo-700 gap-2 shadow-sm">
              <Plus className="h-4 w-4" />
              Gerät hinzufügen
            </Button>
          </div>
        </div>
        {scanMsg && (
          <p className="text-xs text-slate-500">{scanMsg}</p>
        )}
        <div className="flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-1 self-start">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
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
        {duplicateIps.size > 0 && filter !== "managed" && (
          <div className="mx-4 sm:mx-0 flex items-start gap-2 rounded-lg border border-rose-300 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 px-4 py-3 text-sm text-rose-800 dark:text-rose-300">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              <strong>IP-Doppelbelegung:</strong>{" "}
              {[...duplicateIps].sort((a, b) => (ipToInt(a) ?? 0) - (ipToInt(b) ?? 0)).join(", ")}
            </span>
          </div>
        )}

        <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-x-auto">
          <Table className="table-fixed w-full min-w-[640px]">
            <TableHeader>
              <TableRow className="border-slate-200 dark:border-slate-700 hover:bg-transparent bg-slate-50/80 dark:bg-slate-900/50">
                <TableHead className="w-[88px]">Status</TableHead>
                <TableHead className="w-[28%]">Gerät</TableHead>
                <TableHead className="w-[140px]">IP</TableHead>
                <TableHead className="hidden xl:table-cell w-[140px]">MAC</TableHead>
                <TableHead className="hidden lg:table-cell w-[130px]">Port</TableHead>
                <TableHead className="w-[100px]">Bereich</TableHead>
                <TableHead className="w-[72px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleCount === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={7} className="text-center py-16">
                    <div className="flex flex-col items-center gap-3 text-slate-500">
                      {filter === "unknown" ? (
                        <Radar className="h-12 w-12 text-slate-300 dark:text-slate-600" />
                      ) : (
                        <MonitorSmartphone className="h-12 w-12 text-slate-300 dark:text-slate-600" />
                      )}
                      <p className="font-medium text-slate-600 dark:text-slate-400">
                        {filter === "unknown"
                          ? "Keine unbekannten Scan-Funde"
                          : "Keine Geräte erfasst"}
                      </p>
                      <p className="text-sm">
                        {filter === "unknown"
                          ? "Alle gescannten Hosts sind bereits zugeordnet."
                          : "Erfasse Geräte manuell oder übernehme Funde vom Hub-Scan."}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              )}

              {vlanGroups.map((group) => {
                const vlanCount = group.areas.reduce((n, a) => n + a.items.length, 0);
                return (
                  <Fragment key={group.meta.vlanDbId ?? "none"}>
                    <TableRow className="border-slate-200 dark:border-slate-700 hover:bg-transparent bg-slate-100/80 dark:bg-slate-900/80">
                      <TableCell colSpan={7} className="py-2">
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
                            <TableCell colSpan={7} className="py-1.5 pl-6">
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

                        {areaGroup.items.map((row) => {
                          if (row.kind === "client") {
                            const c = row.client;
                            const Icon = TYPE_ICON[c.type] ?? MonitorSmartphone;
                            const ip = c.ipAddress || c.device?.ipAddress || null;
                            const scanHit = c.macAddress
                              ? scanByMac.get(c.macAddress.toUpperCase())
                              : undefined;
                            const scanned = scanOnline(c.lastSeenAt)
                              ?? scanOnline(scanHit?.lastSeenAt ?? null);
                            const deviceOnline = c.device?.lastUpdate
                              ? new Date(c.device.lastUpdate).getTime() > fiveMinAgo
                              : null;
                            const online =
                              scanned === null && deviceOnline === null
                                ? null
                                : scanned === true || deviceOnline === true;
                            const verified = ipVerified(c.macAddress, ip);
                            return (
                              <TableRow key={`c-${c.id}`} className="border-slate-200 dark:border-slate-700">
                                <TableCell>
                                  <StatusBadge online={online} />
                                </TableCell>
                                <TableCell className="max-w-0">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <div className="h-7 w-7 rounded-md bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                                      <Icon className="h-3.5 w-3.5" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <p className="font-medium text-sm text-slate-900 dark:text-slate-100 truncate" title={c.name}>
                                        {c.name}
                                      </p>
                                      <p className="text-[11px] text-slate-400 truncate">
                                        {CLIENT_TYPES.find((t) => t.value === c.type)?.label ?? c.type}
                                        {c.device && (
                                          <>
                                            {" · "}
                                            <Link
                                              href={`/devices/${c.device.id}`}
                                              className="text-indigo-500 hover:underline"
                                            >
                                              {c.device.name}
                                            </Link>
                                          </>
                                        )}
                                      </p>
                                    </div>
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <IpCell ip={ip} verified={verified} isStatic={c.isStatic} />
                                </TableCell>
                                <TableCell className="hidden xl:table-cell font-mono text-xs text-slate-500 truncate">
                                  {c.macAddress || <span className="text-slate-300">–</span>}
                                </TableCell>
                                <TableCell className="hidden lg:table-cell">
                                  {c.port ? (
                                    <Link
                                      href={`/network/${c.port.deviceId}`}
                                      className="inline-flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:underline truncate max-w-full"
                                      title={`${c.port.deviceName} · Port ${c.port.number}`}
                                    >
                                      <EthernetPort className="h-3 w-3 shrink-0" />
                                      <span className="truncate">P{c.port.number}</span>
                                    </Link>
                                  ) : (
                                    <span className="text-xs text-slate-400">–</span>
                                  )}
                                </TableCell>
                                <TableCell className="max-w-0">
                                  {row.areaId != null ? (
                                    <Badge variant="secondary" className="text-xs font-normal max-w-full truncate">
                                      {row.areaName}
                                    </Badge>
                                  ) : (
                                    <span className="text-xs text-slate-400">–</span>
                                  )}
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center justify-end gap-0.5">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-slate-400 hover:text-indigo-600"
                                      onClick={() => openEdit(c)}
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-slate-400 hover:text-rose-600"
                                      onClick={() => handleDelete(c)}
                                      disabled={deletingId === c.id}
                                    >
                                      {deletingId === c.id
                                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        : <Trash2 className="h-3.5 w-3.5" />}
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          }

                          if (row.kind === "iot") {
                            const d = row.device;
                            const online = d.lastUpdate
                              ? new Date(d.lastUpdate).getTime() > fiveMinAgo
                              : null;
                            return (
                              <TableRow key={`iot-${d.id}`} className="border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30">
                                <TableCell>
                                  <StatusBadge online={online} />
                                </TableCell>
                                <TableCell className="max-w-0">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <div className="h-7 w-7 rounded-md bg-slate-500/10 text-slate-500 flex items-center justify-center shrink-0">
                                      <Cpu className="h-3.5 w-3.5" />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <Link
                                        href={`/devices/${d.id}`}
                                        className="font-medium text-sm text-slate-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 truncate block"
                                        title={d.name}
                                      >
                                        {d.name}
                                      </Link>
                                      <p className="text-[11px] text-slate-400 truncate">IoT (nicht zugeordnet)</p>
                                    </div>
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <IpCell ip={d.ipAddress} verified={false} />
                                </TableCell>
                                <TableCell className="hidden xl:table-cell">
                                  <span className="text-slate-300 text-xs">–</span>
                                </TableCell>
                                <TableCell className="hidden lg:table-cell">
                                  <span className="text-xs text-slate-400">–</span>
                                </TableCell>
                                <TableCell>
                                  {row.areaId != null ? (
                                    <Badge variant="secondary" className="text-xs font-normal opacity-70">
                                      {row.areaName}
                                    </Badge>
                                  ) : (
                                    <span className="text-xs text-slate-400">–</span>
                                  )}
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center justify-end">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-7 text-xs gap-1"
                                      onClick={() => openAdd(d)}
                                    >
                                      <Link2 className="h-3 w-3" />
                                      Zuordnen
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          }

                          const d = row.discovered;
                          const active = new Date(d.lastSeenAt).getTime() > activeCutoff;
                          const label = d.hostname?.split(".")[0]
                            || d.deviceType
                            || d.vendor
                            || "Unbekanntes Gerät";
                          return (
                            <TableRow
                              key={`scan-${d.id}`}
                              className="border-slate-200 dark:border-slate-700 bg-violet-50/40 dark:bg-violet-950/20"
                            >
                              <TableCell>
                                <StatusBadge online={active} />
                              </TableCell>
                              <TableCell className="max-w-0">
                                <div className="flex items-center gap-2 min-w-0">
                                  <div className="h-7 w-7 rounded-md bg-violet-500/10 text-violet-600 dark:text-violet-400 flex items-center justify-center shrink-0">
                                    <Radar className="h-3.5 w-3.5" />
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="font-medium text-sm text-slate-900 dark:text-slate-100 truncate" title={label}>
                                      {label}
                                    </p>
                                    <p className="text-[11px] text-slate-400 truncate">
                                      neu vom Scan
                                      {d.deviceType ? ` · ${d.deviceType}` : ""}
                                    </p>
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell>
                                <IpCell
                                  ip={d.ipAddress}
                                  verified={active && !!d.ipAddress}
                                  conflict={!!d.ipAddress && duplicateIps.has(d.ipAddress)}
                                />
                              </TableCell>
                              <TableCell className="hidden xl:table-cell font-mono text-xs text-slate-500 truncate">
                                {d.macAddress}
                              </TableCell>
                              <TableCell className="hidden lg:table-cell">
                                <span className="text-xs text-slate-400">–</span>
                              </TableCell>
                              <TableCell>
                                {row.areaId != null ? (
                                  <Badge variant="secondary" className="text-xs font-normal opacity-70">
                                    {row.areaName}
                                  </Badge>
                                ) : (
                                  <span className="text-xs text-slate-400">–</span>
                                )}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center justify-end">
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
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Gerät bearbeiten" : "Neues Netzwerkgerät"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5 col-span-2 sm:col-span-1">
                <Label>Name <span className="text-rose-500">*</span></Label>
                <Input
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="z.B. Kassen-PC Shop"
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-1.5 col-span-2 sm:col-span-1">
                <Label>Typ</Label>
                <Select value={form.type} onValueChange={(v) => set("type", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CLIENT_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>IP-Adresse</Label>
                <Input value={form.ipAddress} onChange={(e) => set("ipAddress", e.target.value)} placeholder="192.168.10.50" className="font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label>MAC-Adresse</Label>
                <Input value={form.macAddress} onChange={(e) => set("macAddress", e.target.value)} placeholder="AA:BB:CC:DD:EE:FF" className="font-mono" />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-800 p-3">
              <div>
                <p className="text-sm font-medium">Feste IP</p>
                <p className="text-xs text-slate-500">Statisch vergeben statt DHCP</p>
              </div>
              <Switch checked={form.isStatic} onCheckedChange={(v) => set("isStatic", v)} />
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Zuordnung</p>
              <div className="space-y-1.5">
                <Label className="text-xs">Verknüpftes IoT-Gerät</Label>
                <Select value={form.deviceId} onValueChange={(v) => set("deviceId", v)}>
                  <SelectTrigger><SelectValue placeholder="Kein Gerät" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Kein Gerät</SelectItem>
                    {iotDevices
                      .filter((d) => !linkedDeviceIds.has(d.id) || String(d.id) === form.deviceId)
                      .map((d) => (
                        <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Switch-Port</Label>
                  <Select value={form.portId} onValueChange={(v) => set("portId", v)}>
                    <SelectTrigger><SelectValue placeholder="Kein Port" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Kein Port (WLAN)</SelectItem>
                      {selectablePorts.map((p) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.deviceName} · Port {p.number}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">VLAN</Label>
                  <Select value={form.vlanId} onValueChange={(v) => set("vlanId", v)}>
                    <SelectTrigger><SelectValue placeholder="Kein VLAN" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Kein VLAN</SelectItem>
                      {vlans.map((v) => (
                        <SelectItem key={v.id} value={String(v.id)}>
                          {v.vlanId} · {v.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 col-span-2">
                  <Label className="text-xs">Bereich</Label>
                  <Select value={form.areaId} onValueChange={(v) => set("areaId", v)}>
                    <SelectTrigger><SelectValue placeholder="Kein Bereich" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Kein Bereich / automatisch</SelectItem>
                      {areas.map((a) => (
                        <SelectItem key={a.id} value={String(a.id)}>
                          {a.name}
                          {a.ipFrom && a.ipTo ? ` (${a.ipFrom}–${a.ipTo})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Notizen</Label>
              <Input value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="optional" />
            </div>

            {error && (
              <p className="text-sm text-rose-600 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 rounded-lg">{error}</p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
                Abbrechen
              </Button>
              <Button
                type="submit"
                disabled={saving || !form.name.trim()}
                className="bg-indigo-600 hover:bg-indigo-700 min-w-28"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : (editing ? "Speichern" : "Erstellen")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

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
            </div>

            <div className="space-y-1.5">
              <Label>Name <span className="text-rose-500">*</span></Label>
              <Input
                value={adoptForm.name}
                onChange={(e) => setAdoptForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="z.B. Kassen-PC Shop"
                required
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>Typ</Label>
              <Select value={adoptForm.type} onValueChange={(v) => setAdoptForm((f) => ({ ...f, type: v }))}>
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
                <Select value={adoptForm.areaId} onValueChange={(v) => setAdoptForm((f) => ({ ...f, areaId: v }))}>
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

            {adoptError && (
              <p className="text-sm text-rose-600 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 rounded-lg">{adoptError}</p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setAdopting(null)} disabled={adoptSaving}>
                Abbrechen
              </Button>
              <Button
                type="submit"
                disabled={adoptSaving || !adoptForm.name.trim()}
                className="bg-indigo-600 hover:bg-indigo-700 min-w-28"
              >
                {adoptSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Übernehmen"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
