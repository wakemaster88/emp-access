"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, Pencil, EyeOff } from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm";
import { WidgetForm } from "@/components/admin/widget-form";
import type { Cam, Widget } from "@/lib/types";
import { useToast } from "@/components/ui/toast";

const TYPE_LABELS: Record<Widget["type"], string> = {
  reolink: "Reolink",
  iframe: "iFrame",
  "image-refresh": "Bild",
  clock: "Uhr",
  doorbird: "Doorbird",
  scans: "Scan-Monitor",
  tailgate: "Drehkreuz-Kontrolle",
};

export default function WidgetsPage() {
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [cams, setCams] = useState<Cam[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Widget | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Widget | null>(null);
  const { toast } = useToast();

  async function refresh() {
    setLoading(true);
    const [wRes, cRes] = await Promise.all([
      fetch("/api/widgets", { cache: "no-store" }),
      fetch("/api/cams", { cache: "no-store" }),
    ]);
    setWidgets(await wRes.json());
    setCams(await cRes.json());
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleDelete() {
    if (!deleting) return;
    const r = await fetch(`/api/widgets/${deleting.id}`, { method: "DELETE" });
    if (r.ok) {
      toast(`Widget "${deleting.title}" gelöscht`, "success");
      setDeleting(null);
      refresh();
    } else {
      toast("Löschen fehlgeschlagen", "error");
    }
  }

  function widgetSummary(w: Widget) {
    switch (w.type) {
      case "reolink": {
        const cam = cams.find((c) => c.id === w.camId);
        return cam ? `${cam.name} – ${cam.model}` : `Cam ${w.camId} fehlt`;
      }
      case "iframe":
        return w.url;
      case "image-refresh":
        return `${w.url} (${w.intervalMs} ms)`;
      case "clock":
        return `${w.format}${w.showSeconds ? " mit Sek." : ""}${w.showDate ? " + Datum" : ""}`;
      case "doorbird":
        return `Türstation · Snapshot alle ${w.snapshotIntervalMs} ms`;
      case "scans": {
        const scope =
          w.deviceIds.length > 0 ? `Geräte ${w.deviceIds.join(", ")}` : "alle Geräte";
        return `${w.limit} Scans · ${scope}${w.deniedOnly ? " · nur abgelehnte" : ""}`;
      }
      case "tailgate": {
        const cam = cams.find((c) => c.id === w.camId);
        return cam ? `${cam.name} · Durchgänge gegen Scans` : "erste Kamera mit Kontrolle";
      }
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Widgets"
        description="Kacheln für das Dashboard. Auto-Grid platziert sie automatisch, oder du nutzt ein Layout."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            Widget hinzufügen
          </Button>
        }
      />

      {loading ? (
        <p className="text-foreground/60">Lade…</p>
      ) : widgets.length === 0 ? (
        <Card>
          <div className="py-8 text-center">
            <p className="text-foreground/60">Noch keine Widgets angelegt.</p>
            <Button className="mt-4" variant="primary" onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              Erstes Widget
            </Button>
          </div>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-2xl bg-tile ring-1 ring-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-tile-accent/30 text-left text-xs uppercase tracking-wider text-foreground/60">
              <tr>
                <th className="px-4 py-3">Titel</th>
                <th className="px-4 py-3">Typ</th>
                <th className="px-4 py-3">Quelle</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {widgets.map((w) => (
                <tr key={w.id} className="border-b border-border last:border-0 hover:bg-tile-accent/30">
                  <td className="px-4 py-3">
                    <div className="font-medium">{w.title}</div>
                    <div className="font-mono text-xs text-foreground/50">{w.id}</div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="info">{TYPE_LABELS[w.type]}</Badge>
                  </td>
                  <td className="px-4 py-3 max-w-md truncate font-mono text-xs text-foreground/70">
                    {widgetSummary(w)}
                  </td>
                  <td className="px-4 py-3">
                    {w.enabled ? (
                      <Badge variant="success">aktiv</Badge>
                    ) : (
                      <Badge>
                        <EyeOff className="size-3" /> aus
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" onClick={() => setEditing(w)}>
                        <Pencil className="size-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => setDeleting(w)}>
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        title="Neues Widget"
        size="lg"
      >
        <WidgetForm
          cams={cams}
          onSaved={() => {
            setCreating(false);
            refresh();
          }}
          onCancel={() => setCreating(false)}
        />
      </Dialog>

      <Dialog
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? `Widget bearbeiten – ${editing.title}` : ""}
        size="lg"
      >
        {editing && (
          <WidgetForm
            initial={editing}
            cams={cams}
            onSaved={() => {
              setEditing(null);
              refresh();
            }}
            onCancel={() => setEditing(null)}
          />
        )}
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        title={`Widget "${deleting?.title}" löschen?`}
        destructive
        confirmLabel="Löschen"
        onConfirm={handleDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
