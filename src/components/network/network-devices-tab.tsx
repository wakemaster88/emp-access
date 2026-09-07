"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  Plus, Loader2, Server, Router, Wifi, Shield, HardDrive,
  Pencil, Trash2, ChevronRight, MapPin, EthernetPort,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  NETWORK_DEVICE_TYPES,
  scanOnline,
  type NetworkDeviceRow,
} from "@/components/network/network-types";

function lastSeenLabel(iso: string | null): string {
  if (!iso) return "Noch nie im Netzwerk-Scan gesehen";
  return `Zuletzt gesehen: ${new Date(iso).toLocaleString("de-DE")}`;
}

const TYPE_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  SWITCH:       { label: "Switch",       icon: Server,    color: "bg-primary/10 text-primary" },
  ROUTER:       { label: "Router",       icon: Router,    color: "bg-success/10 text-success" },
  ACCESS_POINT: { label: "Access Point", icon: Wifi,      color: "bg-info/10 text-info" },
  FIREWALL:     { label: "Firewall",     icon: Shield,    color: "bg-destructive/10 text-destructive" },
  OTHER:        { label: "Sonstiges",    icon: HardDrive, color: "bg-slate-500/10 text-muted-foreground" },
};

const EMPTY = {
  name: "",
  type: "SWITCH",
  vendor: "",
  model: "",
  ipAddress: "",
  macAddress: "",
  location: "",
  notes: "",
  portCount: "24",
};

export function NetworkDevicesTab({ devices }: { devices: NetworkDeviceRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<NetworkDeviceRow | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState("");

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((p) => ({ ...p, [key]: value }));
  }

  function openAdd() {
    setEditing(null);
    setForm(EMPTY);
    setError("");
    setOpen(true);
  }

  function openEdit(d: NetworkDeviceRow) {
    setEditing(d);
    setForm({
      name: d.name,
      type: d.type,
      vendor: d.vendor ?? "",
      model: d.model ?? "",
      ipAddress: d.ipAddress ?? "",
      macAddress: d.macAddress ?? "",
      location: d.location ?? "",
      notes: d.notes ?? "",
      portCount: String(d.portCount),
    });
    setError("");
    setOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    setError("");

    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      type: form.type,
      vendor: form.vendor,
      model: form.model,
      ipAddress: form.ipAddress,
      macAddress: form.macAddress,
      location: form.location,
      notes: form.notes,
    };
    if (!editing) {
      payload.portCount = form.portCount === "" ? 0 : Number(form.portCount);
    }

    try {
      const res = await fetch(
        editing ? `/api/network/devices/${editing.id}` : "/api/network/devices",
        {
          method: editing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
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

  async function handleDelete(d: NetworkDeviceRow) {
    if (!confirm(`"${d.name}" inklusive aller Ports wirklich löschen?`)) return;
    setDeletingId(d.id);
    try {
      const res = await fetch(`/api/network/devices/${d.id}`, { method: "DELETE" });
      if (res.ok) router.refresh();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4">
        <CardTitle className="text-base sm:text-xl">
          Switches &amp; Router ({devices.length})
        </CardTitle>
        <Button onClick={openAdd} className="gap-2 shadow-sm">
          <Plus className="h-4 w-4" />
          Hardware hinzufügen
        </Button>
      </CardHeader>
      <CardContent className="p-0 sm:px-6 sm:pb-6">
        <div className="rounded-lg border border-border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent bg-muted/40">
                <TableHead className="min-w-[180px]">Gerät</TableHead>
                <TableHead className="hidden md:table-cell">Modell</TableHead>
                <TableHead className="hidden lg:table-cell">IP-Adresse</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden sm:table-cell">Standort</TableHead>
                <TableHead>Ports</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {devices.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={7} className="text-center py-16">
                    <div className="flex flex-col items-center gap-3 text-muted-foreground">
                      <Server className="h-12 w-12 text-slate-300 dark:text-slate-600" />
                      <p className="font-medium text-muted-foreground">
                        Keine Netzwerk-Hardware erfasst
                      </p>
                      <p className="text-sm">
                        Lege Switches, Router oder Access Points an, um dein Netzwerk zu dokumentieren.
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {devices.map((d) => {
                const meta = TYPE_META[d.type] ?? TYPE_META.OTHER;
                const Icon = meta.icon;
                return (
                  <TableRow
                    key={d.id}
                    className="group border-border hover:bg-primary/10"
                  >
                    <TableCell>
                      <Link href={`/network/${d.id}`} className="flex items-center gap-3 min-w-0">
                        <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center shrink-0", meta.color)}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-sm text-foreground group-hover:text-indigo-600 dark:group-hover:text-indigo-400 truncate">
                            {d.name}
                          </p>
                          <p className="text-xs text-muted-foreground/70">{meta.label}</p>
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                      {[d.vendor, d.model].filter(Boolean).join(" ") || <span className="text-slate-300">–</span>}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell font-mono text-xs text-muted-foreground">
                      {d.ipAddress || <span className="text-slate-300">–</span>}
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const online = scanOnline(d.lastSeenAt);
                        if (online === true) {
                          return (
                            <Badge
                              className="bg-success/12 text-success gap-1.5 text-xs h-5"
                              title={lastSeenLabel(d.lastSeenAt)}
                            >
                              <span className="h-1.5 w-1.5 rounded-full bg-success" />
                              Online
                            </Badge>
                          );
                        }
                        if (online === false) {
                          return (
                            <Badge
                              variant="secondary"
                              className="text-muted-foreground gap-1.5 text-xs h-5"
                              title={lastSeenLabel(d.lastSeenAt)}
                            >
                              <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                              Offline
                            </Badge>
                          );
                        }
                        return (
                          <span className="text-xs text-slate-300" title={lastSeenLabel(d.lastSeenAt)}>
                            –
                          </span>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {d.location ? (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <MapPin className="h-3 w-3 text-muted-foreground/70" />
                          {d.location}
                        </span>
                      ) : (
                        <span className="text-slate-300">–</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {d.portCount > 0 ? (
                        <Badge variant="secondary" className="gap-1 text-xs">
                          <EthernetPort className="h-3 w-3" />
                          {d.usedPorts} / {d.portCount}
                        </Badge>
                      ) : (
                        <span className="text-slate-300 text-xs">–</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground/70 hover:text-primary"
                          onClick={() => openEdit(d)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground/70 hover:text-destructive"
                          onClick={() => handleDelete(d)}
                          disabled={deletingId === d.id}
                        >
                          {deletingId === d.id
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : <Trash2 className="h-4 w-4" />}
                        </Button>
                        <Link href={`/network/${d.id}`}>
                          <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-indigo-500" />
                        </Link>
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
            <DialogTitle>{editing ? "Hardware bearbeiten" : "Neue Hardware"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5 col-span-2 sm:col-span-1">
                <Label>Name <span className="text-destructive">*</span></Label>
                <Input
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="z.B. Switch Serverraum"
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-1.5 col-span-2 sm:col-span-1">
                <Label>Typ</Label>
                <Select value={form.type} onValueChange={(v) => set("type", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {NETWORK_DEVICE_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Hersteller</Label>
                <Input value={form.vendor} onChange={(e) => set("vendor", e.target.value)} placeholder="UniFi, Mikrotik …" />
              </div>
              <div className="space-y-1.5">
                <Label>Modell</Label>
                <Input value={form.model} onChange={(e) => set("model", e.target.value)} placeholder="USW-24-PoE" />
              </div>
              <div className="space-y-1.5">
                <Label>IP-Adresse</Label>
                <Input value={form.ipAddress} onChange={(e) => set("ipAddress", e.target.value)} placeholder="192.168.1.2" className="font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label>MAC-Adresse</Label>
                <Input value={form.macAddress} onChange={(e) => set("macAddress", e.target.value)} placeholder="AA:BB:CC:DD:EE:FF" className="font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label>Standort</Label>
                <Input value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="Serverraum" />
              </div>
              {!editing && (
                <div className="space-y-1.5">
                  <Label>Anzahl Ports</Label>
                  <Input
                    type="number"
                    min={0}
                    max={96}
                    value={form.portCount}
                    onChange={(e) => set("portCount", e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground/70">Ports werden automatisch angelegt (1–n).</p>
                </div>
              )}
              <div className="space-y-1.5 col-span-2">
                <Label>Notizen</Label>
                <Input value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="optional" />
              </div>
            </div>

            {error && (
              <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg">{error}</p>
            )}

            <div className="flex justify-end gap-2 pt-1">
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
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
