"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { StatusDot } from "@/components/ui/status-dot";
import {
  Plus, Loader2, Server, Router, Wifi, Shield, HardDrive,
  Pencil, Trash2, ChevronRight, MapPin, EthernetPort,
  type LucideIcon,
} from "lucide-react";
import {
  NETWORK_DEVICE_TYPES,
  scanOnline,
  type NetworkDeviceRow,
} from "@/components/network/network-types";

function lastSeenLabel(iso: string | null): string {
  if (!iso) return "Noch nie im Netzwerk-Scan gesehen";
  return `Zuletzt gesehen: ${new Date(iso).toLocaleString("de-DE")}`;
}

// Der Gerätetyp ist kein Zustand: neutrales Symbol statt Zustandsfarben
// (docs/design-regeln.md, Abschnitt 3). Online/Offline trägt die Status-Spalte.
const TYPE_META: Record<string, { label: string; icon: LucideIcon }> = {
  SWITCH:       { label: "Switch",       icon: Server },
  ROUTER:       { label: "Router",       icon: Router },
  ACCESS_POINT: { label: "Access Point", icon: Wifi },
  FIREWALL:     { label: "Firewall",     icon: Shield },
  OTHER:        { label: "Sonstiges",    icon: HardDrive },
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
  // Rückfrage vor dem Löschen als AlertDialog (docs/design-regeln.md, Abschnitt 18);
  // das Gerät bleibt gesetzt, solange der Dialog ausblendet.
  const [toDelete, setToDelete] = useState<NetworkDeviceRow | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

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

  function askDelete(d: NetworkDeviceRow) {
    setToDelete(d);
    setConfirmOpen(true);
  }

  async function handleDelete(d: NetworkDeviceRow) {
    setDeletingId(d.id);
    try {
      const res = await fetch(`/api/network/devices/${d.id}`, { method: "DELETE" });
      if (res.ok) router.refresh();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Card flush>
      {/* Kopf: Titel links, Primärhandlung oben rechts; auf dem Handy „+ Hardware“ (docs/design-regeln.md, Abschnitt 13). */}
      <CardHeader>
        <CardTitle className="tabular-nums">
          Switches &amp; Router ({devices.length})
        </CardTitle>
        <CardAction>
          <Button onClick={openAdd} className="gap-2 max-sm:h-11" aria-label="Hardware hinzufügen">
            <Plus className="h-4 w-4" />
            <span>Hardware<span className="max-sm:hidden"> hinzufügen</span></span>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {/* Tabelle bis an den Kartenrand (docs/design-regeln.md, Abschnitt 17).
            Handy (326 px): Gerät und Tasten; Status und Ports stehen als Nebenzeile unter dem Namen,
            der Pfeil entfällt (der Name führt schon zur Detailseite). */}
        <div className="-mx-4 sm:-mx-[18px]">
          <Table edge>
            <TableHeader>
              <TableRow>
                <TableHead className="sm:min-w-[180px]">Gerät</TableHead>
                <TableHead className="hidden md:table-cell">Modell</TableHead>
                <TableHead className="hidden lg:table-cell">IP-Adresse</TableHead>
                <TableHead className="max-sm:hidden">Status</TableHead>
                <TableHead className="hidden sm:table-cell">Standort</TableHead>
                <TableHead className="max-sm:hidden">Ports</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {devices.length === 0 && (
                <TableEmpty
                  colSpan={7}
                  compact={false}
                  icon={Server}
                  title="Keine Netzwerk-Hardware erfasst"
                  description="Lege Switches, Router oder Access Points an, um dein Netzwerk zu dokumentieren."
                />
              )}
              {devices.map((d) => {
                const meta = TYPE_META[d.type] ?? TYPE_META.OTHER;
                const Icon = meta.icon;
                const online = scanOnline(d.lastSeenAt);
                return (
                  <TableRow
                    key={d.id}
                    className="group"
                  >
                    {/* Gerät – auf dem Handy nimmt die Spalte den Rest der Breite und kürzt den Namen. */}
                    <TableCell className="max-sm:w-full max-sm:max-w-0">
                      <Link href={`/network/${d.id}`} className="flex items-center gap-3 min-w-0">
                        <IconChip icon={Icon} />
                        <div className="min-w-0">
                          <p className="font-medium text-sm text-foreground group-hover:text-primary truncate">
                            {d.name}
                          </p>
                          <p className="text-xs text-muted-foreground">{meta.label}</p>
                          {/* Handy: Status und belegte Ports als Nebenzeile (ab sm eigene Spalten). */}
                          {(online !== null || d.portCount > 0) && (
                            <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground sm:hidden">
                              {online !== null && (
                                <span className="inline-flex items-center gap-1.5">
                                  <StatusDot tone={online ? "success" : "neutral"} size="xs" />
                                  {online ? "Online" : "Offline"}
                                </span>
                              )}
                              {online !== null && d.portCount > 0 && <span aria-hidden>·</span>}
                              {d.portCount > 0 && (
                                <span className="tabular-nums">{d.usedPorts} / {d.portCount} Ports</span>
                              )}
                            </p>
                          )}
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                      {[d.vendor, d.model].filter(Boolean).join(" ") || <span className="text-muted-foreground">–</span>}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell font-mono text-xs text-muted-foreground">
                      {d.ipAddress || <span className="text-muted-foreground">–</span>}
                    </TableCell>
                    <TableCell className="max-sm:hidden">
                      {(() => {
                        if (online === true) {
                          return (
                            <Badge
                              variant="success"
                              className="gap-1.5"
                              title={lastSeenLabel(d.lastSeenAt)}
                            >
                              <StatusDot tone="success" size="xs" />
                              Online
                            </Badge>
                          );
                        }
                        if (online === false) {
                          return (
                            <Badge
                              variant="neutral"
                              className="gap-1.5"
                              title={lastSeenLabel(d.lastSeenAt)}
                            >
                              <StatusDot tone="neutral" size="xs" />
                              Offline
                            </Badge>
                          );
                        }
                        return (
                          <span className="text-xs text-muted-foreground" title={lastSeenLabel(d.lastSeenAt)}>
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
                        <span className="text-muted-foreground">–</span>
                      )}
                    </TableCell>
                    <TableCell className="max-sm:hidden">
                      {d.portCount > 0 ? (
                        <Badge variant="secondary" className="gap-1 text-xs tabular-nums">
                          <EthernetPort className="h-3 w-3" />
                          {d.usedPorts} / {d.portCount}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">–</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-muted-foreground hover:text-primary max-sm:size-11"
                          onClick={() => openEdit(d)}
                          aria-label="Bearbeiten"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-muted-foreground hover:text-destructive max-sm:size-11"
                          onClick={() => askDelete(d)}
                          disabled={deletingId === d.id}
                          aria-label="Löschen"
                        >
                          {deletingId === d.id
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : <Trash2 className="h-4 w-4" />}
                        </Button>
                        {/* Pfeil erst ab sm: auf dem Handy führt der Name zur Detailseite.
                            Als Taste bekommt er bei Touch eine eigene Tippfläche, und „Löschen“
                            davor reicht nicht mehr in ihn hinein. */}
                        <Button asChild variant="ghost" size="icon-sm" className="max-sm:hidden">
                          <Link href={`/network/${d.id}`} aria-label={d.name}>
                            <ChevronRight className="h-4 w-4 text-muted-foreground/60 group-hover:text-primary" />
                          </Link>
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
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Hardware bearbeiten" : "Neue Hardware"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Auf dem Handy eine Spalte, damit IP- und MAC-Adresse nicht abgeschnitten werden. */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Name <span className="text-destructive">*</span></Label>
                <Input
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="z.B. Switch Serverraum"
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label>Typ</Label>
                <Select value={form.type} onValueChange={(v) => set("type", v)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
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
                  <p className="text-xs text-muted-foreground">Ports werden automatisch angelegt (1–n).</p>
                </div>
              )}
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Notizen</Label>
                <Input value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="optional" />
              </div>
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

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent aria-describedby={undefined}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {toDelete ? `"${toDelete.name}" inklusive aller Ports wirklich löschen?` : ""}
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
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
