"use client";

import { useMemo, useState } from "react";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { findVlanForIp } from "@/lib/ip";
import {
  CLIENT_TYPES,
  scanOnline,
  vlanColor,
  type ClientRow,
  type IotDeviceOption,
  type PortOption,
  type VlanRow,
} from "@/components/network/network-types";

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
  notes: "",
};

interface ClientsTabProps {
  clients: ClientRow[];
  iotDevices: IotDeviceOption[];
  vlans: VlanRow[];
  ports: PortOption[];
}

export function ClientsTab({ clients, iotDevices, vlans, ports }: ClientsTabProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ClientRow | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState("");

  // IoT-Geraete, die noch nicht als NetworkClient erfasst sind, werden
  // automatisch mit angezeigt (nur lesend, bis man sie zuordnet).
  const linkedDeviceIds = useMemo(
    () => new Set(clients.map((c) => c.device?.id).filter(Boolean)),
    [clients]
  );
  const unlinkedIot = iotDevices.filter((d) => d.isActive && !linkedDeviceIds.has(d.id));

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
      notes: c.notes ?? "",
    });
    setError("");
    setOpen(true);
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

  // Freie Ports + der aktuell zugewiesene Port des bearbeiteten Clients.
  const selectablePorts = ports.filter(
    (p) => !p.occupied || (editing?.port && p.id === editing.port.id)
  );

  const fiveMinAgo = Date.now() - 5 * 60 * 1000;

  return (
    <Card className="border-slate-200 dark:border-slate-800">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4">
        <CardTitle className="text-base sm:text-xl">
          Geräte im Netzwerk ({clients.length + unlinkedIot.length})
        </CardTitle>
        <Button onClick={() => openAdd()} className="bg-indigo-600 hover:bg-indigo-700 gap-2 shadow-sm">
          <Plus className="h-4 w-4" />
          Gerät hinzufügen
        </Button>
      </CardHeader>
      <CardContent className="p-0 sm:px-6 sm:pb-6">
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-slate-200 dark:border-slate-700 hover:bg-transparent bg-slate-50/80 dark:bg-slate-900/50">
                <TableHead className="min-w-[180px]">Gerät</TableHead>
                <TableHead className="hidden md:table-cell">IP-Adresse</TableHead>
                <TableHead className="hidden lg:table-cell">MAC</TableHead>
                <TableHead className="hidden sm:table-cell">Switch / Port</TableHead>
                <TableHead>VLAN</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.length === 0 && unlinkedIot.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={6} className="text-center py-16">
                    <div className="flex flex-col items-center gap-3 text-slate-500">
                      <MonitorSmartphone className="h-12 w-12 text-slate-300 dark:text-slate-600" />
                      <p className="font-medium text-slate-600 dark:text-slate-400">Keine Geräte erfasst</p>
                      <p className="text-sm">
                        Erfasse PCs, Drucker, Kameras &amp; Co. oder verknüpfe bestehende IoT-Geräte.
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              )}

              {clients.map((c) => {
                const Icon = TYPE_ICON[c.type] ?? MonitorSmartphone;
                const ip = c.ipAddress || c.device?.ipAddress || null;
                // Online, wenn der Hub-Scan das Geraet kuerzlich gesehen hat
                // oder das verknuepfte IoT-Geraet sich gemeldet hat.
                const scanned = scanOnline(c.lastSeenAt);
                const deviceOnline = c.device?.lastUpdate
                  ? new Date(c.device.lastUpdate).getTime() > fiveMinAgo
                  : null;
                const online =
                  scanned === null && deviceOnline === null
                    ? null
                    : scanned === true || deviceOnline === true;
                return (
                  <TableRow key={`c-${c.id}`} className="border-slate-200 dark:border-slate-700">
                    <TableCell>
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-8 w-8 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-sm text-slate-900 dark:text-slate-100 truncate">
                            {c.name}
                          </p>
                          <div className="flex items-center gap-1.5">
                            <p className="text-xs text-slate-400">
                              {CLIENT_TYPES.find((t) => t.value === c.type)?.label ?? c.type}
                            </p>
                            {c.device && (
                              <Link
                                href={`/devices/${c.device.id}`}
                                className="inline-flex items-center gap-0.5 text-xs text-indigo-500 hover:underline"
                              >
                                <Link2 className="h-3 w-3" />
                                {c.device.name}
                              </Link>
                            )}
                            {online === true && (
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" title="Online" />
                            )}
                            {online === false && (
                              <span className="h-1.5 w-1.5 rounded-full bg-slate-300" title="Offline" />
                            )}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell font-mono text-xs text-slate-500">
                      {ip ? (
                        <span>
                          {ip}
                          {c.isStatic && <span className="ml-1 text-slate-400" title="Feste IP">(fest)</span>}
                        </span>
                      ) : (
                        <span className="text-slate-300">–</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell font-mono text-xs text-slate-500">
                      {c.macAddress || <span className="text-slate-300">–</span>}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {c.port ? (
                        <Link
                          href={`/network/${c.port.deviceId}`}
                          className="inline-flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                        >
                          <EthernetPort className="h-3 w-3" />
                          {c.port.deviceName} · Port {c.port.number}
                        </Link>
                      ) : (
                        <span className="text-xs text-slate-400">–</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {c.vlan ? (
                        <Badge className={cn("text-xs", vlanColor(c.vlan.id))}>
                          {c.vlan.vlanId} · {c.vlan.name}
                        </Badge>
                      ) : (
                        <span className="text-xs text-slate-400">–</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-slate-400 hover:text-indigo-600"
                          onClick={() => openEdit(c)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-slate-400 hover:text-rose-600"
                          onClick={() => handleDelete(c)}
                          disabled={deletingId === c.id}
                        >
                          {deletingId === c.id
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : <Trash2 className="h-4 w-4" />}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}

              {/* Nicht erfasste IoT-Geraete (automatisch eingeblendet) */}
              {unlinkedIot.map((d) => {
                const online = d.lastUpdate
                  ? new Date(d.lastUpdate).getTime() > fiveMinAgo
                  : null;
                // VLAN rein anzeigen (aus dem Subnetz abgeleitet) - persistiert
                // wird es erst bei der Zuordnung.
                const derivedVlan = findVlanForIp(d.ipAddress, vlans);
                return (
                  <TableRow key={`iot-${d.id}`} className="border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30">
                    <TableCell>
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-8 w-8 rounded-lg bg-slate-500/10 text-slate-500 flex items-center justify-center shrink-0">
                          <Cpu className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <Link
                            href={`/devices/${d.id}`}
                            className="font-medium text-sm text-slate-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 truncate block"
                          >
                            {d.name}
                          </Link>
                          <div className="flex items-center gap-1.5">
                            <p className="text-xs text-slate-400">IoT-Gerät (nicht zugeordnet)</p>
                            {online === true && (
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" title="Online" />
                            )}
                            {online === false && (
                              <span className="h-1.5 w-1.5 rounded-full bg-slate-300" title="Offline" />
                            )}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell font-mono text-xs text-slate-500">
                      {d.ipAddress || <span className="text-slate-300">–</span>}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <span className="text-slate-300 text-xs">–</span>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <span className="text-xs text-slate-400">–</span>
                    </TableCell>
                    <TableCell>
                      {derivedVlan ? (
                        <Badge className={cn("text-xs opacity-70", vlanColor(derivedVlan.id))} title="Automatisch aus dem Subnetz erkannt">
                          {derivedVlan.vlanId} · {derivedVlan.name}
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
    </Card>
  );
}
