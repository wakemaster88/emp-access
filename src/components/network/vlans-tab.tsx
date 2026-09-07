"use client";

import { useState } from "react";
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
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
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

  async function handleDelete(v: VlanRow) {
    if (!confirm(`VLAN ${v.vlanId} (${v.name}) wirklich löschen?`)) return;
    setDeletingId(v.id);
    try {
      const res = await fetch(`/api/network/vlans/${v.id}`, { method: "DELETE" });
      if (res.ok) router.refresh();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4">
        <CardTitle className="text-base sm:text-xl">VLANs ({vlans.length})</CardTitle>
        <Button onClick={openAdd} className="gap-2 shadow-sm">
          <Plus className="h-4 w-4" />
          VLAN hinzufügen
        </Button>
      </CardHeader>
      <CardContent className="p-0 sm:px-6 sm:pb-6">
        <div className="rounded-lg border border-border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent bg-muted/40">
                <TableHead className="w-20">VLAN</TableHead>
                <TableHead className="min-w-[140px]">Name</TableHead>
                <TableHead className="hidden md:table-cell">Subnetz</TableHead>
                <TableHead className="hidden lg:table-cell">Gateway</TableHead>
                <TableHead>Nutzung</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {vlans.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={6} className="text-center py-16">
                    <div className="flex flex-col items-center gap-3 text-muted-foreground">
                      <Network className="h-12 w-12 text-slate-300 dark:text-slate-600" />
                      <p className="font-medium text-muted-foreground">Keine VLANs erfasst</p>
                      <p className="text-sm">Lege VLANs an, z. B. Management, IoT oder Gäste-WLAN.</p>
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {vlans.map((v) => (
                <TableRow key={v.id} className="border-border">
                  <TableCell>
                    <Badge className={cn("text-xs font-mono", vlanColor(v.id))}>{v.vlanId}</Badge>
                  </TableCell>
                  <TableCell>
                    <p className="font-medium text-sm text-foreground">{v.name}</p>
                    {v.description && <p className="text-xs text-muted-foreground/70 truncate max-w-[220px]">{v.description}</p>}
                  </TableCell>
                  <TableCell className="hidden md:table-cell font-mono text-xs text-muted-foreground">
                    {v.subnet || <span className="text-slate-300">–</span>}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell font-mono text-xs text-muted-foreground">
                    {v.gateway || <span className="text-slate-300">–</span>}
                  </TableCell>
                  <TableCell>
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
                        size="icon"
                        className="h-8 w-8 text-muted-foreground/70 hover:text-primary"
                        onClick={() => openEdit(v)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground/70 hover:text-destructive"
                        onClick={() => handleDelete(v)}
                        disabled={deletingId === v.id}
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
            <div className="grid grid-cols-2 gap-3">
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

            {error && (
              <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg">{error}</p>
            )}

            <div className="flex justify-end gap-2 pt-1">
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
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
