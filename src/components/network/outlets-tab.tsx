"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
  Plus, Loader2, Cable, Pencil, Trash2, MapPin, EthernetPort,
} from "lucide-react";
import { OUTLET_TYPES, type OutletRow } from "@/components/network/network-types";

const EMPTY = { label: "", location: "", type: "WALL_OUTLET", notes: "" };

export function OutletsTab({ outlets }: { outlets: OutletRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<OutletRow | null>(null);
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

  function openEdit(o: OutletRow) {
    setEditing(o);
    setForm({
      label: o.label,
      location: o.location ?? "",
      type: o.type,
      notes: o.notes ?? "",
    });
    setError("");
    setOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.label.trim()) return;
    setSaving(true);
    setError("");

    try {
      const res = await fetch(
        editing ? `/api/network/outlets/${editing.id}` : "/api/network/outlets",
        {
          method: editing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            label: form.label.trim(),
            location: form.location,
            type: form.type,
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

  async function handleDelete(o: OutletRow) {
    if (!confirm(`Anschluss "${o.label}" wirklich löschen?`)) return;
    setDeletingId(o.id);
    try {
      const res = await fetch(`/api/network/outlets/${o.id}`, { method: "DELETE" });
      if (res.ok) router.refresh();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Card className="border-slate-200 dark:border-slate-800">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4">
        <CardTitle className="text-base sm:text-xl">Anschlüsse ({outlets.length})</CardTitle>
        <Button onClick={openAdd} className="bg-indigo-600 hover:bg-indigo-700 gap-2 shadow-sm">
          <Plus className="h-4 w-4" />
          Anschluss hinzufügen
        </Button>
      </CardHeader>
      <CardContent className="p-0 sm:px-6 sm:pb-6">
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-slate-200 dark:border-slate-700 hover:bg-transparent bg-slate-50/80 dark:bg-slate-900/50">
                <TableHead className="min-w-[140px]">Beschriftung</TableHead>
                <TableHead>Typ</TableHead>
                <TableHead className="hidden sm:table-cell">Standort</TableHead>
                <TableHead>Verbunden mit</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {outlets.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={5} className="text-center py-16">
                    <div className="flex flex-col items-center gap-3 text-slate-500">
                      <Cable className="h-12 w-12 text-slate-300 dark:text-slate-600" />
                      <p className="font-medium text-slate-600 dark:text-slate-400">Keine Anschlüsse erfasst</p>
                      <p className="text-sm">
                        Erfasse Wanddosen und Patchpanel-Ports, um die Verkabelung zu dokumentieren.
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {outlets.map((o) => (
                <TableRow key={o.id} className="border-slate-200 dark:border-slate-700">
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400 flex items-center justify-center shrink-0">
                        <Cable className="h-4 w-4" />
                      </div>
                      <p className="font-medium text-sm text-slate-900 dark:text-slate-100">{o.label}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-xs">
                      {OUTLET_TYPES.find((t) => t.value === o.type)?.label ?? o.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {o.location ? (
                      <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                        <MapPin className="h-3 w-3 text-slate-400" />
                        {o.location}
                      </span>
                    ) : (
                      <span className="text-slate-300">–</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {o.port ? (
                      <Link
                        href={`/network/${o.port.deviceId}`}
                        className="inline-flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                      >
                        <EthernetPort className="h-3 w-3" />
                        {o.port.deviceName} · Port {o.port.number}
                      </Link>
                    ) : (
                      <span className="text-xs text-slate-400">Nicht verbunden</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-slate-400 hover:text-indigo-600"
                        onClick={() => openEdit(o)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-slate-400 hover:text-rose-600"
                        onClick={() => handleDelete(o)}
                        disabled={deletingId === o.id}
                      >
                        {deletingId === o.id
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
            <DialogTitle>{editing ? "Anschluss bearbeiten" : "Neuer Anschluss"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Beschriftung <span className="text-rose-500">*</span></Label>
                <Input
                  value={form.label}
                  onChange={(e) => set("label", e.target.value)}
                  placeholder="Dose 2.OG-14"
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label>Typ</Label>
                <Select value={form.type} onValueChange={(v) => set("type", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {OUTLET_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Standort</Label>
              <Input value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="z.B. Shop, Technikraum" />
            </div>
            <div className="space-y-1.5">
              <Label>Notizen</Label>
              <Input value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="optional" />
            </div>
            <p className="text-xs text-slate-400">
              Die Verbindung zu einem Switch-Port stellst du auf der Switch-Detailseite am jeweiligen Port her.
            </p>

            {error && (
              <p className="text-sm text-rose-600 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 rounded-lg">{error}</p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
                Abbrechen
              </Button>
              <Button
                type="submit"
                disabled={saving || !form.label.trim()}
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
