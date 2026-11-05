"use client";

import { useState } from "react";
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
  Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Notice } from "@/components/ui/notice";
import {
  Plus, Loader2, Network, Pencil, Trash2, EthernetPort, MonitorSmartphone,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { vlanColor, type VlanRow } from "@/components/network/network-types";

const EMPTY = { vlanId: "", name: "", subnet: "", gateway: "", description: "" };

export function VlansTab({ vlans }: { vlans: VlanRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<VlanRow | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  // Rückfrage vor dem Löschen als AlertDialog (docs/design-regeln.md, Abschnitt 18);
  // das VLAN bleibt gesetzt, solange der Dialog ausblendet.
  const [toDelete, setToDelete] = useState<VlanRow | null>(null);
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

  function openEdit(v: VlanRow) {
    setEditing(v);
    setForm({
      vlanId: String(v.vlanId),
      name: v.name,
      subnet: v.subnet ?? "",
      gateway: v.gateway ?? "",
      description: v.description ?? "",
    });
    setError("");
    setOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.vlanId) return;
    setSaving(true);
    setError("");

    try {
      const res = await fetch(
        editing ? `/api/network/vlans/${editing.id}` : "/api/network/vlans",
        {
          method: editing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vlanId: Number(form.vlanId),
            name: form.name.trim(),
            subnet: form.subnet,
            gateway: form.gateway,
            description: form.description,
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

  function askDelete(v: VlanRow) {
    setToDelete(v);
    setConfirmOpen(true);
  }

  async function handleDelete(v: VlanRow) {
    setDeletingId(v.id);
    try {
      const res = await fetch(`/api/network/vlans/${v.id}`, { method: "DELETE" });
      if (res.ok) router.refresh();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Card flush>
      {/* Kopf: Titel links, Primärhandlung oben rechts; auf dem Handy „+ VLAN“ (docs/design-regeln.md, Abschnitt 13). */}
      <CardHeader>
        <CardTitle className="tabular-nums row-span-2 self-center">VLANs ({vlans.length})</CardTitle>
        <CardAction>
          <Button onClick={openAdd} className="gap-2 max-sm:h-11" aria-label="VLAN hinzufügen">
            <Plus className="h-4 w-4" />
            <span>VLAN<span className="max-sm:hidden"> hinzufügen</span></span>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {/* Tabelle bis an den Kartenrand (docs/design-regeln.md, Abschnitt 17).
            Handy (326 px): VLAN, Name und Tasten; die Nutzung steht als Nebenzeile unter dem Namen. */}
        <div className="-mx-4 sm:-mx-[18px]">
          <Table edge>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">VLAN</TableHead>
                <TableHead className="sm:min-w-[140px]">Name</TableHead>
                <TableHead className="hidden md:table-cell">Subnetz</TableHead>
                <TableHead className="hidden lg:table-cell">Gateway</TableHead>
                <TableHead className="max-sm:hidden">Nutzung</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {vlans.length === 0 && (
                <TableEmpty
                  colSpan={6}
                  compact={false}
                  icon={Network}
                  title="Keine VLANs erfasst"
                  description="Lege VLANs an, z. B. Management, IoT oder Gäste-WLAN."
                />
              )}
              {vlans.map((v) => (
                <TableRow key={v.id}>
                  <TableCell>
                    <Badge className={cn("text-xs font-mono", vlanColor(v.id, vlans))}>{v.vlanId}</Badge>
                  </TableCell>
                  {/* Name – auf dem Handy nimmt die Spalte den Rest der Breite und kürzt. */}
                  <TableCell className="max-sm:w-full max-sm:max-w-0">
                    <p className="font-medium text-sm text-foreground max-sm:truncate">{v.name}</p>
                    {v.description && <p className="text-xs text-muted-foreground truncate max-w-[220px]">{v.description}</p>}
                    {/* Handy: Nutzung als Nebenzeile (ab sm eigene Spalte). */}
                    <p className="text-xs text-muted-foreground tabular-nums sm:hidden">
                      {v.portCount + v.taggedPortCount} Ports · {v.clientCount} Geräte
                    </p>
                  </TableCell>
                  <TableCell className="hidden md:table-cell font-mono text-xs text-muted-foreground">
                    {v.subnet || <span className="text-muted-foreground">–</span>}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell font-mono text-xs text-muted-foreground">
                    {v.gateway || <span className="text-muted-foreground">–</span>}
                  </TableCell>
                  <TableCell className="max-sm:hidden">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <EthernetPort className="h-3 w-3 text-muted-foreground/70" />
                        {v.portCount + v.taggedPortCount} Ports
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <MonitorSmartphone className="h-3 w-3 text-muted-foreground/70" />
                        {v.clientCount} Geräte
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-primary max-sm:size-11"
                        onClick={() => openEdit(v)}
                        aria-label="Bearbeiten"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-destructive max-sm:size-11"
                        onClick={() => askDelete(v)}
                        disabled={deletingId === v.id}
                        aria-label="Löschen"
                      >
                        {deletingId === v.id
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <Trash2 className="h-4 w-4" />}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "VLAN bearbeiten" : "Neues VLAN"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>VLAN-ID <span className="text-destructive">*</span></Label>
                <Input
                  type="number"
                  min={1}
                  max={4094}
                  value={form.vlanId}
                  onChange={(e) => set("vlanId", e.target.value)}
                  placeholder="10"
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>Name <span className="text-destructive">*</span></Label>
                <Input
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="z.B. IoT, Management, Gäste"
                  required
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Subnetz</Label>
                <Input value={form.subnet} onChange={(e) => set("subnet", e.target.value)} placeholder="192.168.10.0/24" className="font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label>Gateway</Label>
                <Input value={form.gateway} onChange={(e) => set("gateway", e.target.value)} placeholder="192.168.10.1" className="font-mono" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Beschreibung</Label>
              <Input value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="optional" />
            </div>

            {error && <Notice tone="danger" compact title={error} />}

            <DialogFooter className="pt-1">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
                Abbrechen
              </Button>
              <Button
                type="submit"
                disabled={saving || !form.name.trim() || !form.vlanId}
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
              {toDelete ? `VLAN ${toDelete.vlanId} (${toDelete.name}) wirklich löschen?` : ""}
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
