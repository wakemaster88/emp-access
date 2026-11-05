"use client";

import { useMemo, useState, Fragment } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { IconChip } from "@/components/ui/icon-chip";
import { Notice } from "@/components/ui/notice";
import { Segmented } from "@/components/ui/segmented";
import { StatusDot } from "@/components/ui/status-dot";
import {
  Plus, Loader2, Pencil, Trash2, MonitorSmartphone, Monitor as MonitorIcon,
  Printer, Camera, HardDrive, Phone, Cpu, Laptop, EthernetPort, Link2,
  Radar, AlertTriangle, RefreshCw, BadgeCheck, Lock,
  type LucideIcon,
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
      <Badge variant="success" className="gap-1 text-[11px] h-5 px-1.5 font-medium">
        <StatusDot tone="success" size="xs" />
        Online
      </Badge>
    );
  }
  if (online === false) {
    return (
      <Badge variant="neutral" className="gap-1 text-[11px] h-5 px-1.5 font-medium">
        <StatusDot tone="neutral" size="xs" />
        Offline
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground gap-1 text-[11px] h-5 px-1.5 font-normal">
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
  if (!ip) return <span className="text-muted-foreground">–</span>;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-mono text-xs",
        conflict ? "text-destructive font-semibold" : "text-muted-foreground"
      )}
    >
      {isStatic && (
        // Feste IP ist eine Eigenschaft, kein Hinweis: gedämpft statt Warnfarbe.
        <Lock
          className="h-3 w-3 text-muted-foreground shrink-0"
          aria-label="Feste IP"
        />
      )}
      {ip}
      {verified && (
        <BadgeCheck
          className="h-3.5 w-3.5 text-success shrink-0"
          aria-label="IP vom Scan bestätigt"
        />
      )}
    </span>
  );
}

const TYPE_ICON: Record<string, LucideIcon> = {
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
/** "all" = jedes VLAN, "none" = ohne VLAN, sonst DB-ID des VLANs. */
type VlanFilter = "all" | "none" | number;

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
  const [vlanFilter, setVlanFilter] = useState<VlanFilter>("all");

  // Rückfrage vor dem Entfernen als AlertDialog (docs/design-regeln.md, Abschnitt 18);
  // das Gerät bleibt gesetzt, solange der Dialog ausblendet.
  const [toDelete, setToDelete] = useState<ClientRow | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const [adopting, setAdopting] = useState<DiscoveredRow | null>(null);
  const [adoptForm, setAdoptForm] = useState({ name: "", type: "OTHER", areaId: "none" });
  const [adoptSaving, setAdoptSaving] = useState(false);
  const [adoptError, setAdoptError] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState("");
  // Fehler getrennt vom Fortschritt, damit sie als Notice erscheinen
  // (docs/design-regeln.md, Abschnitt 19).
  const [scanError, setScanError] = useState("");

  const activeCutoff = Date.now() - 15 * 60_000;

  function failScan(message: string) {
    setScanMsg("");
    setScanError(message);
    setScanning(false);
  }

  async function triggerScan() {
    if (scanning) return;
    setScanning(true);
    setScanError("");
    setScanMsg("Scan wird gestartet …");
    try {
      const res = await fetch("/api/network/scan", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        failScan(data.error ?? "Scan konnte nicht gestartet werden");
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
          failScan(
            /arp fehlgeschlagen/i.test(err)
              ? "Hub-Software veraltet – bitte auf dem iMac einmal aktualisieren: hub/install/update.sh"
              : (body.error ?? "Scan fehlgeschlagen")
          );
          return;
        }
        setScanMsg(body.status === "RUNNING" ? "Hub scannt …" : "Warte auf Hub …");
      }
      failScan("Timeout – Seite später neu laden");
    } catch {
      failScan("Netzwerkfehler");
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

  function askDelete(c: ClientRow) {
    setToDelete(c);
    setConfirmOpen(true);
  }

  async function handleDelete(c: ClientRow) {
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

    const filteredRows =
      vlanFilter === "all"
        ? rows
        : rows.filter((row) =>
            vlanFilter === "none" ? row.vlanDbId == null : row.vlanDbId === vlanFilter
          );

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
    for (const row of filteredRows) {
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
  }, [clients, unlinkedIot, unknownDiscovered, vlans, areas, filter, vlanFilter]);

  const visibleCount = vlanGroups.reduce(
    (n, g) => n + g.areas.reduce((m, a) => m + a.items.length, 0),
    0
  );

  const vlanChipCounts = useMemo(() => {
    const counts = new Map<number | "none", number>();
    const bump = (key: number | "none") => counts.set(key, (counts.get(key) ?? 0) + 1);

    if (filter !== "unknown") {
      for (const c of clients) {
        const ip = c.ipAddress || c.device?.ipAddress || null;
        const derived = c.vlan ? null : findVlanForIp(ip, vlans);
        const id = c.vlan?.id ?? derived?.id ?? null;
        bump(id ?? "none");
      }
      for (const d of unlinkedIot) {
        const derived = findVlanForIp(d.ipAddress, vlans);
        bump(derived?.id ?? "none");
      }
    }
    if (filter !== "managed") {
      for (const d of unknownDiscovered) {
        const derived = findVlanForIp(d.ipAddress, vlans);
        bump(derived?.id ?? "none");
      }
    }
    return counts;
  }, [clients, unlinkedIot, unknownDiscovered, vlans, filter]);

  // Anzahlen als Zahl im Segment (count), wie in den übrigen Segmentwahlen.
  const FILTERS: { value: ListFilter; label: string; count: number }[] = [
    { value: "all", label: "Alle", count: managedCount + unknownDiscovered.length },
    { value: "managed", label: "Verwaltet", count: managedCount },
    { value: "unknown", label: "Neu vom Scan", count: unknownDiscovered.length },
  ];

  const totalForVlanChips = [...vlanChipCounts.values()].reduce((a, b) => a + b, 0);
  const VLAN_FILTERS: { value: VlanFilter; label: string; count?: number }[] = [
    { value: "all", label: "Alle VLANs", count: totalForVlanChips },
    ...vlans.map((v) => ({
      value: v.id as VlanFilter,
      label: `${v.vlanId} · ${v.name}`,
      count: vlanChipCounts.get(v.id),
    })),
    ...((vlanChipCounts.get("none") ?? 0) > 0 || vlanFilter === "none"
      ? [{ value: "none" as VlanFilter, label: "Ohne VLAN", count: vlanChipCounts.get("none") ?? 0 }]
      : []),
  ];

  const lastScanAt = useMemo(() => {
    let latest = 0;
    for (const d of discovered) {
      const t = new Date(d.lastSeenAt).getTime();
      if (t > latest) latest = t;
    }
    return latest > 0 ? new Date(latest) : null;
  }, [discovered]);

  function formatLastScan(at: Date): string {
    const diffMin = Math.floor((Date.now() - at.getTime()) / 60_000);
    const absolute = at.toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    if (diffMin < 1) return `gerade eben (${absolute})`;
    if (diffMin < 60) return `vor ${diffMin} Min. (${absolute})`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 48) return `vor ${diffH} Std. (${absolute})`;
    return absolute;
  }

  return (
    <Card flush>
      {/* items-stretch: Titelzeile, Scan-Hinweis und Filter nehmen die volle Breite ein,
          damit die Tasten rechts stehen wie in den anderen Tabs (CardHeader setzt items-start). */}
      <CardHeader className="flex flex-col items-stretch gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <CardTitle className="tabular-nums">
              Geräte im Netzwerk ({visibleCount})
            </CardTitle>
            <CardDescription className="text-xs mt-1">
              {lastScanAt
                ? <>Letzter Hub-Scan: <span className="text-foreground/80 font-medium">{formatLastScan(lastScanAt)}</span></>
                : "Noch kein Hub-Scan in der Cloud"}
            </CardDescription>
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
            <Button
              type="button"
              variant="outline"
              onClick={triggerScan}
              disabled={scanning}
              className="gap-2 max-sm:h-11"
            >
              {scanning
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <RefreshCw className="h-4 w-4" />}
              {scanning ? "Scannt …" : "Netzwerk scannen"}
            </Button>
            <Button onClick={() => openAdd()} className="gap-2 max-sm:h-11">
              <Plus className="h-4 w-4" />
              Gerät hinzufügen
            </Button>
          </div>
        </div>
        {scanMsg && (
          <p className="text-xs text-muted-foreground">{scanMsg}</p>
        )}
        {scanError && <Notice tone="danger" compact title={scanError} />}
        {/* Filter und VLAN-Wahl als Segmentwahl (docs/design-regeln.md, Abschnitt 6).
            Auf dem Handy enger gesetzt, damit „Neu vom Scan“ samt Zahl in die Kapsel passt
            (bei 390 px sonst 356 px Inhalt auf 322 px, die Zahl verschwand im Scrollbereich). */}
        <div className="flex flex-col gap-2 w-full min-w-0">
          <Segmented
            aria-label="Filter"
            value={filter}
            onValueChange={setFilter}
            options={FILTERS}
            className="self-start max-sm:[&>button]:gap-1 max-sm:[&>button]:px-2"
          />
          {vlans.length > 0 && (
            <Segmented
              aria-label="VLAN"
              value={String(vlanFilter)}
              onValueChange={(v) => setVlanFilter(v === "all" || v === "none" ? v : Number(v))}
              options={VLAN_FILTERS.map((f) => ({ value: String(f.value), label: f.label, count: f.count }))}
              className="self-start max-sm:[&>button]:gap-1 max-sm:[&>button]:px-2"
            />
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Dauerhinweis, kein frisch aufgetretener Fehler: status statt alert,
            sonst liest der Screenreader ihn bei jedem Tabwechsel laut vor. */}
        {duplicateIps.size > 0 && filter !== "managed" && (
          <Notice tone="danger" compact icon={AlertTriangle} title="IP-Doppelbelegung:" role="status">
            {[...duplicateIps].sort((a, b) => (ipToInt(a) ?? 0) - (ipToInt(b) ?? 0)).join(", ")}
          </Notice>
        )}

        {/* Tabelle bis an den Kartenrand (docs/design-regeln.md, Abschnitt 17). */}
        <div className="-mx-4 sm:-mx-[18px]">
          <Table edge className="table-fixed w-full min-w-[640px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[88px]">Status</TableHead>
                <TableHead className="w-[28%]">Gerät</TableHead>
                <TableHead className="w-[140px]">IP</TableHead>
                <TableHead className="hidden xl:table-cell w-[140px]">MAC</TableHead>
                <TableHead className="hidden lg:table-cell w-[130px]">Port</TableHead>
                <TableHead className="w-[100px]">Bereich</TableHead>
                {/* Breit genug für „Übernehmen“, sonst ragt die Taste in die Nachbarspalte. */}
                <TableHead className="w-[152px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleCount === 0 && (
                <TableEmpty
                  colSpan={7}
                  compact={false}
                  icon={filter === "unknown" ? Radar : MonitorSmartphone}
                  title={filter === "unknown"
                    ? "Keine unbekannten Scan-Funde"
                    : "Keine Geräte erfasst"}
                  description={filter === "unknown"
                    ? "Alle gescannten Hosts sind bereits zugeordnet."
                    : "Erfasse Geräte manuell oder übernehme Funde vom Hub-Scan."}
                />
              )}

              {vlanGroups.map((group) => {
                const vlanCount = group.areas.reduce((n, a) => n + a.items.length, 0);
                return (
                  <Fragment key={group.meta.vlanDbId ?? "none"}>
                    <TableRow className="bg-glass-tile hover:bg-glass-tile">
                      <TableCell colSpan={7} className="py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          {group.meta.vlanDbId != null ? (
                            <Badge className={cn("text-xs font-mono", vlanColor(group.meta.vlanDbId, vlans))}>
                              VLAN {group.meta.vlanId} · {group.meta.name}
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs">Ohne VLAN</Badge>
                          )}
                          {group.meta.subnet && (
                            <span className="text-[11px] font-mono text-muted-foreground">{group.meta.subnet}</span>
                          )}
                          <span className="text-[11px] text-muted-foreground tabular-nums">{vlanCount} Geräte</span>
                        </div>
                      </TableCell>
                    </TableRow>

                    {group.areas.map((areaGroup) => (
                      <Fragment key={`${group.meta.vlanDbId ?? "none"}-${areaGroup.meta.areaId ?? "none"}`}>
                        {group.showAreas && (
                          <TableRow className="hover:bg-transparent">
                            <TableCell colSpan={7} className="py-1.5">
                              {/* Eingerückt unter der VLAN-Zeile: Randabstand der Tabelle (edge) plus 16 px. */}
                              <div className="flex flex-wrap items-center gap-2 pl-4">
                                <span className="text-label">
                                  {areaGroup.meta.name}
                                </span>
                                <span className="text-[11px] text-muted-foreground tabular-nums">
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
                              <TableRow key={`c-${c.id}`}>
                                <TableCell>
                                  <StatusBadge online={online} />
                                </TableCell>
                                <TableCell className="max-w-0">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <IconChip icon={Icon} size="sm" />
                                    <div className="min-w-0 flex-1">
                                      <p className="font-medium text-sm text-foreground truncate" title={c.name}>
                                        {c.name}
                                      </p>
                                      <p className="text-[11px] text-muted-foreground truncate">
                                        {CLIENT_TYPES.find((t) => t.value === c.type)?.label ?? c.type}
                                        {c.device && (
                                          <>
                                            {" · "}
                                            <Link
                                              href={`/devices/${c.device.id}`}
                                              className="text-primary hover:underline"
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
                                <TableCell className="hidden xl:table-cell font-mono text-xs text-muted-foreground truncate">
                                  {c.macAddress || <span className="text-muted-foreground">–</span>}
                                </TableCell>
                                <TableCell className="hidden lg:table-cell">
                                  {c.port ? (
                                    <Link
                                      href={`/network/${c.port.deviceId}`}
                                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline truncate max-w-full"
                                      title={`${c.port.deviceName} · Port ${c.port.number}`}
                                    >
                                      <EthernetPort className="h-3 w-3 shrink-0" />
                                      <span className="truncate">P{c.port.number}</span>
                                    </Link>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">–</span>
                                  )}
                                </TableCell>
                                <TableCell className="max-w-0">
                                  {row.areaId != null ? (
                                    <Badge variant="secondary" className="text-xs font-normal max-w-full truncate">
                                      {row.areaName}
                                    </Badge>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">–</span>
                                  )}
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center justify-end gap-0.5">
                                    <Button
                                      variant="ghost"
                                      size="icon-sm"
                                      className="text-muted-foreground hover:text-primary max-sm:size-11"
                                      onClick={() => openEdit(c)}
                                      aria-label="Bearbeiten"
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon-sm"
                                      className="text-muted-foreground hover:text-destructive max-sm:size-11"
                                      onClick={() => askDelete(c)}
                                      disabled={deletingId === c.id}
                                      aria-label="Entfernen"
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
                              <TableRow key={`iot-${d.id}`}>
                                <TableCell>
                                  <StatusBadge online={online} />
                                </TableCell>
                                <TableCell className="max-w-0">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <IconChip icon={Cpu} size="sm" />
                                    <div className="min-w-0 flex-1">
                                      <Link
                                        href={`/devices/${d.id}`}
                                        className="font-medium text-sm text-foreground/80 hover:text-primary truncate block"
                                        title={d.name}
                                      >
                                        {d.name}
                                      </Link>
                                      <p className="text-[11px] text-muted-foreground truncate">IoT (nicht zugeordnet)</p>
                                    </div>
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <IpCell ip={d.ipAddress} verified={false} />
                                </TableCell>
                                <TableCell className="hidden xl:table-cell">
                                  <span className="text-muted-foreground text-xs">–</span>
                                </TableCell>
                                <TableCell className="hidden lg:table-cell">
                                  <span className="text-xs text-muted-foreground">–</span>
                                </TableCell>
                                <TableCell>
                                  {row.areaId != null ? (
                                    <Badge variant="secondary" className="text-xs font-normal opacity-70">
                                      {row.areaName}
                                    </Badge>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">–</span>
                                  )}
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center justify-end">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="max-sm:h-11"
                                      onClick={() => openAdd(d)}
                                    >
                                      <Link2 />
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
                            <TableRow key={`scan-${d.id}`}>
                              <TableCell>
                                <StatusBadge online={active} />
                              </TableCell>
                              <TableCell className="max-w-0">
                                <div className="flex items-center gap-2 min-w-0">
                                  {/* Neuer Scan-Fund wartet auf Zuordnung: Hinweisfarbe statt Violett (Musik). */}
                                  <IconChip icon={Radar} size="sm" tone="warning" />
                                  <div className="min-w-0 flex-1">
                                    <p className="font-medium text-sm text-foreground truncate" title={label}>
                                      {label}
                                    </p>
                                    <p className="text-[11px] text-muted-foreground truncate">
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
                              <TableCell className="hidden xl:table-cell font-mono text-xs text-muted-foreground truncate">
                                {d.macAddress}
                              </TableCell>
                              <TableCell className="hidden lg:table-cell">
                                <span className="text-xs text-muted-foreground">–</span>
                              </TableCell>
                              <TableCell>
                                {row.areaId != null ? (
                                  <Badge variant="secondary" className="text-xs font-normal opacity-70">
                                    {row.areaName}
                                  </Badge>
                                ) : (
                                  <span className="text-xs text-muted-foreground">–</span>
                                )}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center justify-end">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="max-sm:h-11"
                                    onClick={() => openAdopt(d)}
                                  >
                                    <Plus />
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
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Gerät bearbeiten" : "Neues Netzwerkgerät"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Auf dem Handy eine Spalte, damit IP- und MAC-Adresse nicht abgeschnitten werden. */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Name <span className="text-destructive">*</span></Label>
                <Input
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="z.B. Kassen-PC Shop"
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label>Typ</Label>
                <Select value={form.type} onValueChange={(v) => set("type", v)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
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

            <div className="glass-tile flex items-center justify-between gap-3 p-3">
              <div>
                <p className="text-sm font-medium">Feste IP</p>
                <p className="text-xs text-muted-foreground">Statisch vergeben statt DHCP</p>
              </div>
              <Switch aria-label="Feste IP" checked={form.isStatic} onCheckedChange={(v) => set("isStatic", v)} />
            </div>

            <div className="glass-tile p-4 space-y-3">
              <p className="text-label">Zuordnung</p>
              <div className="space-y-1.5">
                <Label>Verknüpftes IoT-Gerät</Label>
                <Select value={form.deviceId} onValueChange={(v) => set("deviceId", v)}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Kein Gerät" /></SelectTrigger>
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
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Switch-Port</Label>
                  <Select value={form.portId} onValueChange={(v) => set("portId", v)}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Kein Port" /></SelectTrigger>
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
                  <Label>VLAN</Label>
                  <Select value={form.vlanId} onValueChange={(v) => set("vlanId", v)}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Kein VLAN" /></SelectTrigger>
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
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Bereich</Label>
                  <Select value={form.areaId} onValueChange={(v) => set("areaId", v)}>
                    <SelectTrigger className="w-full"><SelectValue placeholder="Kein Bereich" /></SelectTrigger>
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

            {error && <Notice tone="danger" compact title={error} />}

            <DialogFooter className="pt-1">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
                Abbrechen
              </Button>
              <Button
                type="submit"
                disabled={saving || !form.name.trim()}
                className="min-w-28"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : (editing ? "Speichern" : "Erstellen")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!adopting} onOpenChange={(o) => { if (!o) setAdopting(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Gerät übernehmen</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAdopt} className="space-y-4">
            <div className="glass-tile p-3 text-xs font-mono text-muted-foreground space-y-0.5">
              <p>IP: {adopting?.ipAddress ?? "–"}</p>
              <p>MAC: {adopting?.macAddress}</p>
              {adopting?.hostname && <p>Hostname: {adopting.hostname}</p>}
              {adopting?.vendor && <p>Hersteller: {adopting.vendor}</p>}
              {adopting?.deviceType && <p>Erkannt als: {adopting.deviceType}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Name <span className="text-destructive">*</span></Label>
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
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
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
                  <SelectTrigger className="w-full"><SelectValue placeholder="Automatisch" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Automatisch aus IP</SelectItem>
                    {areas.map((a) => (
                      <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {adoptError && <Notice tone="danger" compact title={adoptError} />}

            <DialogFooter className="pt-1">
              <Button type="button" variant="outline" onClick={() => setAdopting(null)} disabled={adoptSaving}>
                Abbrechen
              </Button>
              <Button
                type="submit"
                disabled={adoptSaving || !adoptForm.name.trim()}
                className="min-w-28"
              >
                {adoptSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Übernehmen"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent aria-describedby={undefined}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {toDelete ? `"${toDelete.name}" aus der Netzwerk-Verwaltung entfernen?` : ""}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (toDelete) void handleDelete(toDelete);
              }}
            >
              Entfernen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
