"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import type { Layout, Widget } from "@/lib/types";

interface Position {
  x: number;
  y: number;
  w: number;
  h: number;
}

export default function LayoutEditorPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const [layout, setLayout] = useState<Layout | null>(null);
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    (async () => {
      const [layoutsRes, widgetsRes] = await Promise.all([
        fetch("/api/layouts", { cache: "no-store" }),
        fetch("/api/widgets", { cache: "no-store" }),
      ]);
      const layoutData = await layoutsRes.json();
      const found = (layoutData.layouts as Layout[]).find((l) => l.id === id);
      setLayout(found ?? null);
      setWidgets(await widgetsRes.json());
    })();
  }, [id]);

  if (!layout) return <p className="text-foreground/60">Lade…</p>;

  function setPosition(widgetId: string, pos: Position | null) {
    setLayout((prev) => {
      if (!prev) return prev;
      const positions = { ...prev.positions };
      if (pos) {
        positions[widgetId] = pos;
      } else {
        delete positions[widgetId];
      }
      return { ...prev, positions };
    });
  }

  async function save() {
    if (!layout) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/layouts/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(layout),
      });
      if (r.ok) {
        toast("Layout gespeichert", "success");
      } else {
        toast("Speichern fehlgeschlagen", "error");
      }
    } finally {
      setSaving(false);
    }
  }

  async function activate() {
    await fetch("/api/layouts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activeLayoutId: id }),
    });
    toast("Layout aktiviert", "success");
  }

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href="/admin/layouts"
        className="mb-4 inline-flex items-center gap-2 text-sm text-foreground/60 hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Zurück zu Layouts
      </Link>
      <PageHeader
        title={`Layout-Editor – ${layout.name}`}
        description={`${layout.cols} × ${layout.rows} Grid · Positionen für jedes Widget definieren`}
        actions={
          <>
            <Button variant="secondary" onClick={activate}>
              Aktivieren
            </Button>
            <Button variant="primary" onClick={save} disabled={saving}>
              {saving ? "Speichere…" : "Speichern"}
            </Button>
          </>
        }
      />

      <Card>
        <p className="mb-4 text-sm text-foreground/60">
          x, y = Position (0-basiert), w/h = Breite/Höhe in Grid-Einheiten. Lass das Feld leer,
          wenn ein Widget in diesem Layout <em>nicht</em> angezeigt werden soll.
        </p>
        <div className="space-y-3">
          {widgets.map((w) => {
            const pos = layout.positions[w.id];
            const placed = !!pos;
            return (
              <div
                key={w.id}
                className="grid items-center gap-3 sm:grid-cols-[1fr_auto_auto_auto_auto_auto]"
              >
                <div>
                  <div className="font-medium">{w.title}</div>
                  <div className="font-mono text-xs text-foreground/50">{w.id}</div>
                </div>
                <Field label="x">
                  <Input
                    type="number"
                    className="w-20"
                    value={pos?.x ?? 0}
                    onChange={(e) =>
                      setPosition(w.id, {
                        x: Number(e.target.value),
                        y: pos?.y ?? 0,
                        w: pos?.w ?? 3,
                        h: pos?.h ?? 3,
                      })
                    }
                  />
                </Field>
                <Field label="y">
                  <Input
                    type="number"
                    className="w-20"
                    value={pos?.y ?? 0}
                    onChange={(e) =>
                      setPosition(w.id, {
                        x: pos?.x ?? 0,
                        y: Number(e.target.value),
                        w: pos?.w ?? 3,
                        h: pos?.h ?? 3,
                      })
                    }
                  />
                </Field>
                <Field label="w">
                  <Input
                    type="number"
                    className="w-20"
                    value={pos?.w ?? 3}
                    onChange={(e) =>
                      setPosition(w.id, {
                        x: pos?.x ?? 0,
                        y: pos?.y ?? 0,
                        w: Number(e.target.value),
                        h: pos?.h ?? 3,
                      })
                    }
                  />
                </Field>
                <Field label="h">
                  <Input
                    type="number"
                    className="w-20"
                    value={pos?.h ?? 3}
                    onChange={(e) =>
                      setPosition(w.id, {
                        x: pos?.x ?? 0,
                        y: pos?.y ?? 0,
                        w: pos?.w ?? 3,
                        h: Number(e.target.value),
                      })
                    }
                  />
                </Field>
                <div className="flex items-end pb-1">
                  {placed ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setPosition(w.id, null)}
                    >
                      Entfernen
                    </Button>
                  ) : (
                    <span className="text-xs text-foreground/40">nicht platziert</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {widgets.length === 0 && (
        <Card className="mt-4">
          <p className="text-foreground/60">
            Lege erst Widgets an, dann kannst du sie hier positionieren.
          </p>
        </Card>
      )}
    </div>
  );
}
