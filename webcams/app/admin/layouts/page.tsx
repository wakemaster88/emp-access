"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Trash2, Pencil, Check } from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import type { Layout } from "@/lib/types";

export default function LayoutsPage() {
  const [layouts, setLayouts] = useState<Layout[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Layout | null>(null);
  const [newLayout, setNewLayout] = useState({ id: "", name: "", cols: 12, rows: 8 });
  const { toast } = useToast();

  async function refresh() {
    const r = await fetch("/api/layouts", { cache: "no-store" });
    const data = await r.json();
    setLayouts(data.layouts);
    setActiveId(data.activeLayoutId);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function setActive(id: string | null) {
    const r = await fetch("/api/layouts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activeLayoutId: id }),
    });
    if (r.ok) {
      toast(id ? "Layout aktiviert" : "Auto-Grid aktiv", "success");
      refresh();
    } else {
      toast("Fehler", "error");
    }
  }

  async function create() {
    if (!newLayout.id || !newLayout.name) {
      toast("ID und Name erforderlich", "error");
      return;
    }
    const r = await fetch("/api/layouts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: newLayout.id,
        name: newLayout.name,
        cols: newLayout.cols,
        rows: newLayout.rows,
        positions: {},
        focusWidgetId: null,
      }),
    });
    if (r.ok) {
      toast("Layout angelegt", "success");
      setCreating(false);
      setNewLayout({ id: "", name: "", cols: 12, rows: 8 });
      refresh();
    } else {
      const json = await r.json();
      toast(json.error ?? "Fehler", "error");
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    const r = await fetch(`/api/layouts/${deleting.id}`, { method: "DELETE" });
    if (r.ok) {
      toast(`Layout "${deleting.name}" gelöscht`, "success");
      setDeleting(null);
      refresh();
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Layouts"
        description="Mehrere benannte Layouts mit individuellen Positionen pro Widget. Standard ist Auto-Grid."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            Layout anlegen
          </Button>
        }
      />

      <Card className="mb-6">
        <CardHeader>
          <div>
            <CardTitle>Auto-Grid</CardTitle>
            <CardDescription>
              Wenn kein Layout aktiv ist, platziert das Dashboard alle Widgets automatisch.
            </CardDescription>
          </div>
          {!activeId ? (
            <Badge variant="success">
              <Check className="size-3" /> aktiv
            </Badge>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => setActive(null)}>
              Aktivieren
            </Button>
          )}
        </CardHeader>
      </Card>

      {layouts.length === 0 ? (
        <Card>
          <p className="py-6 text-center text-foreground/60">Noch keine Layouts angelegt.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {layouts.map((l) => (
            <Card key={l.id}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-medium">{l.name}</h3>
                    {activeId === l.id && (
                      <Badge variant="success">
                        <Check className="size-3" /> aktiv
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 font-mono text-xs text-foreground/50">
                    {l.id} · {l.cols} × {l.rows} Grid · {Object.keys(l.positions).length} platzierte Widgets
                  </p>
                </div>
                <div className="flex gap-2">
                  {activeId !== l.id && (
                    <Button variant="secondary" size="sm" onClick={() => setActive(l.id)}>
                      Aktivieren
                    </Button>
                  )}
                  <Link
                    href={`/admin/layouts/${l.id}`}
                    className="inline-flex h-8 items-center gap-2 rounded-lg bg-tile-accent px-3 text-xs ring-1 ring-border hover:ring-border-strong"
                  >
                    <Pencil className="size-3" />
                    Editor
                  </Link>
                  <Button size="icon" variant="ghost" onClick={() => setDeleting(l)}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        title="Neues Layout"
        size="md"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="ID">
            <Input
              value={newLayout.id}
              onChange={(e) => setNewLayout({ ...newLayout, id: e.target.value })}
              placeholder="layout-tag"
            />
          </Field>
          <Field label="Name">
            <Input
              value={newLayout.name}
              onChange={(e) => setNewLayout({ ...newLayout, name: e.target.value })}
              placeholder="Tag"
              autoFocus
            />
          </Field>
          <Field label="Spalten">
            <Input
              type="number"
              value={newLayout.cols}
              onChange={(e) => setNewLayout({ ...newLayout, cols: Number(e.target.value) })}
            />
          </Field>
          <Field label="Zeilen">
            <Input
              type="number"
              value={newLayout.rows}
              onChange={(e) => setNewLayout({ ...newLayout, rows: Number(e.target.value) })}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setCreating(false)}>
            Abbrechen
          </Button>
          <Button variant="primary" onClick={create}>
            Anlegen
          </Button>
        </DialogFooter>
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        title={`Layout "${deleting?.name}" löschen?`}
        destructive
        confirmLabel="Löschen"
        onConfirm={handleDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
