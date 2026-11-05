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
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { IconChip } from "@/components/ui/icon-chip";
import { Notice } from "@/components/ui/notice";
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
  // Rückfrage vor dem Löschen als AlertDialog (docs/design-regeln.md, Abschnitt 18);
  // der Anschluss bleibt gesetzt, solange der Dialog ausblendet.
  const [toDelete, setToDelete] = useState<OutletRow | null>(null);
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

  function askDelete(o: OutletRow) {
    setToDelete(o);
    setConfirmOpen(true);
  }

  async function handleDelete(o: OutletRow) {
    setDeletingId(o.id);
    try {
      const res = await fetch(`/api/network/outlets/${o.id}`, { method: "DELETE" });
      if (res.ok) router.refresh();
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Card className="overflow-hidden pb-0 sm:pb-0">
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle className="tabular-nums">Anschlüsse ({outlets.length})</CardTitle>
        <Button onClick={openAdd} className="gap-2 max-sm:h-11">
          <Plus className="h-4 w-4" />
          Anschluss hinzufügen
        </Button>
      </CardHeader>
      <CardContent>
        {/* Tabelle bis an den Kartenrand (docs/design-regeln.md, Abschnitt 17). */}
        <div className="-mx-4 sm:-mx-[18px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[140px] pl-4 sm:pl-[18px]">Beschriftung</TableHead>
                <TableHead>Typ</TableHead>
                <TableHead className="hidden sm:table-cell">Standort</TableHead>
                <TableHead>Verbunden mit</TableHead>
                <TableHead className="w-20 pr-4 sm:pr-[18px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {outlets.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={5} className="p-0 whitespace-normal">
                    <EmptyState
                      icon={Cable}
                      title="Keine Anschlüsse erfasst"
                      description="Erfasse Wanddosen und Patchpanel-Ports, um die Verkabelung zu dokumentieren."
                    />
                  </TableCell>
                </TableRow>
              )}
              {outlets.map((o) => (
                <TableRow key={o.id}>
                  <TableCell className="pl-4 sm:pl-[18px]">
                    <div className="flex items-center gap-3">
                      <IconChip icon={Cable} />
                      <p className="font-medium text-sm text-foreground">{o.label}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-xs">
                      {OUTLET_TYPES.find((t) => t.value === o.type)?.label ?? o.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {o.location ? (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3 text-muted-foreground/70" />
                        {o.location}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">–</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {o.port ? (
                      <Link
                        href={`/network/${o.port.deviceId}`}
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        <EthernetPort className="h-3 w-3" />
                        {o.port.deviceName} · Port {o.port.number}
                      </Link>
                    ) : (
                      <span className="text-xs text-muted-foreground">Nicht verbunden</span>
                    )}
                  </TableCell>
                  <TableCell className="pr-4 sm:pr-[18px]">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-primary max-sm:size-11"
                        onClick={() => openEdit(o)}
                        aria-label="Bearbeiten"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-destructive max-sm:size-11"
                        onClick={() => askDelete(o)}
                        disabled={deletingId === o.id}
                        aria-label="Löschen"
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
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Beschriftung <span className="text-destructive">*</span></Label>
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
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
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
            <p className="text-xs text-muted-foreground">
              Die Verbindung zu einem Switch-Port stellst du auf der Switch-Detailseite am jeweiligen Port her.
            </p>

            {error && <Notice tone="danger" compact title={error} />}

            <DialogFooter className="pt-1">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
                Abbrechen
              </Button>
              <Button
                type="submit"
                disabled={saving || !form.label.trim()}
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
              {toDelete ? `Anschluss "${toDelete.label}" wirklich löschen?` : ""}
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
