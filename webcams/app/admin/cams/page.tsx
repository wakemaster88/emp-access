"use client";

import { useEffect, useState } from "react";
import {
  Plus,
  Trash2,
  Pencil,
  Wifi,
  WifiOff,
  Battery,
  Search,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm";
import { CamForm } from "@/components/admin/cam-form";
import { Field, Input, Label } from "@/components/ui/input";
import { REOLINK_CAPS, REOLINK_MODELS, type Cam, type ReolinkModel } from "@/lib/types";
import { useToast } from "@/components/ui/toast";

interface FoundCam {
  ip: string;
  model: string;
  name: string;
  firmVer: string;
  serial: string;
}

export default function CamsPage() {
  const [cams, setCams] = useState<Cam[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Cam | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Cam | null>(null);
  const [reachable, setReachable] = useState<Record<string, boolean>>({});
  const [scanOpen, setScanOpen] = useState(false);
  const [scanPassword, setScanPassword] = useState("");
  const [scanRunning, setScanRunning] = useState(false);
  const [scanResults, setScanResults] = useState<FoundCam[] | null>(null);
  const [importing, setImporting] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  async function refresh() {
    setLoading(true);
    const r = await fetch("/api/cams", { cache: "no-store" });
    const data: Cam[] = await r.json();
    setCams(data);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function testReachable(camId: string) {
    setReachable((r) => ({ ...r, [camId]: false }));
    const res = await fetch(`/api/cams/${camId}/test`, { method: "POST" });
    const json = await res.json();
    setReachable((r) => ({ ...r, [camId]: !!json.ok }));
  }

  async function handleDelete() {
    if (!deleting) return;
    const r = await fetch(`/api/cams/${deleting.id}`, { method: "DELETE" });
    if (r.ok) {
      toast(`Kamera "${deleting.name}" gelöscht`, "success");
      setDeleting(null);
      refresh();
    } else {
      const json = await r.json();
      toast(`Löschen fehlgeschlagen: ${json.error}`, "error");
    }
  }

  async function runScan() {
    if (!scanPassword) {
      toast("Bitte Passwort eingeben", "error");
      return;
    }
    setScanRunning(true);
    setScanResults(null);
    try {
      const r = await fetch("/api/cams/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: scanPassword }),
      });
      const json = await r.json();
      if (!r.ok) {
        toast(json.error ?? "Scan fehlgeschlagen", "error");
        return;
      }
      setScanResults(json.found);
      toast(
        json.found.length === 0
          ? "Keine neuen Cams gefunden"
          : `${json.found.length} neue Cams gefunden`,
        json.found.length === 0 ? "info" : "success",
      );
    } finally {
      setScanRunning(false);
    }
  }

  function slugify(s: string) {
    return s
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  async function importCam(found: FoundCam) {
    const slug = slugify(found.name) || `cam-${found.ip.replace(/\./g, "-")}`;
    const camId = `cam-${slug}`;
    setImporting((s) => new Set(s).add(found.ip));
    try {
      // DevInfo liefert z. B. "Reolink Duo 3 PoE" — auf bekannte Modelle mappen.
      const model = (REOLINK_MODELS as readonly string[]).includes(found.model)
        ? (found.model as ReolinkModel)
        : /duo/i.test(found.model)
          ? ("Duo 3" as ReolinkModel)
          : ("RLC-810A" as ReolinkModel);
      const camRes = await fetch("/api/cams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: camId,
          name: found.name,
          model,
          ip: found.ip,
          port: 80,
          rtspPort: 554,
          username: "admin",
          password: scanPassword,
          channel: 0,
          streamMain: "h264Preview_01_main",
          streamSub: "h264Preview_01_sub",
          enabled: true,
        }),
      });
      if (!camRes.ok) {
        const j = await camRes.json();
        throw new Error(j.error ?? "Import fehlgeschlagen");
      }
      await fetch("/api/widgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: `w-${slug}`,
          type: "reolink",
          title: found.name,
          camId,
          enabled: true,
          showTitleBar: true,
        }),
      });
      toast(`„${found.name}" importiert`, "success");
      setScanResults((prev) => prev?.filter((f) => f.ip !== found.ip) ?? null);
      refresh();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setImporting((s) => {
        const n = new Set(s);
        n.delete(found.ip);
        return n;
      });
    }
  }

  async function importAll() {
    if (!scanResults) return;
    for (const f of scanResults) {
      // sequenziell, damit go2rtc-yaml nur einmal pro Cam regeneriert wird
      // eslint-disable-next-line no-await-in-loop
      await importCam(f);
    }
    setScanOpen(false);
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Kameras"
        description="Reolink-Cams verwalten. Wird die Kamera gespeichert, generiert das System automatisch die go2rtc-Konfiguration."
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setScanOpen(true)}>
              <Search className="size-4" />
              Netzwerk scannen
            </Button>
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              Kamera hinzufügen
            </Button>
          </div>
        }
      />

      {loading ? (
        <p className="text-foreground/60">Lade…</p>
      ) : cams.length === 0 ? (
        <Card>
          <div className="py-8 text-center">
            <p className="text-foreground/60">Noch keine Kameras konfiguriert.</p>
            <Button className="mt-4" variant="primary" onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              Erste Kamera anlegen
            </Button>
          </div>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-2xl bg-tile ring-1 ring-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-tile-accent/30 text-left text-xs uppercase tracking-wider text-foreground/60">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Modell</th>
                <th className="px-4 py-3">IP</th>
                <th className="px-4 py-3">Caps</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {cams.map((cam) => {
                const caps = REOLINK_CAPS[cam.model];
                return (
                  <tr key={cam.id} className="border-b border-border last:border-0 hover:bg-tile-accent/30">
                    <td className="px-4 py-3">
                      <div className="font-medium">{cam.name}</div>
                      <div className="font-mono text-xs text-foreground/50">{cam.id}</div>
                    </td>
                    <td className="px-4 py-3">{cam.model}</td>
                    <td className="px-4 py-3 font-mono text-xs text-foreground/70">{cam.ip}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {caps.ptz && <Badge variant="info">PTZ</Badge>}
                        {caps.zoom !== "none" && (
                          <Badge variant="info">{caps.zoom === "optical" ? "Zoom opt." : "Zoom dig."}</Badge>
                        )}
                        {caps.spotlight && <Badge variant="warn">Spot</Badge>}
                        {caps.siren && <Badge variant="danger">Sirene</Badge>}
                        {caps.audio2way && <Badge>2-Way</Badge>}
                        {caps.battery && (
                          <Badge>
                            <Battery className="size-3" /> Akku
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {!cam.enabled ? (
                        <Badge>deaktiviert</Badge>
                      ) : reachable[cam.id] === undefined ? (
                        <button
                          onClick={() => testReachable(cam.id)}
                          className="text-xs text-foreground/60 hover:text-foreground"
                        >
                          prüfen
                        </button>
                      ) : reachable[cam.id] ? (
                        <Badge variant="success">
                          <Wifi className="size-3" /> erreichbar
                        </Badge>
                      ) : (
                        <Badge variant="danger">
                          <WifiOff className="size-3" /> offline
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" onClick={() => setEditing(cam)} aria-label="Bearbeiten">
                          <Pencil className="size-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => setDeleting(cam)} aria-label="Löschen">
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={creating}
        onClose={() => setCreating(false)}
        title="Neue Kamera"
        description="Trage IP, Login und Modell ein. Speichern legt die Kamera an und aktualisiert go2rtc."
        size="lg"
      >
        <CamForm
          allCams={cams}
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
        title={editing ? `Kamera bearbeiten – ${editing.name}` : ""}
        size="lg"
      >
        {editing && (
          <CamForm
            initial={editing}
            allCams={cams}
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
        title={`Kamera "${deleting?.name}" löschen?`}
        description="Verknüpfte Widgets werden ebenfalls entfernt. go2rtc wird neu geladen."
        destructive
        confirmLabel="Löschen"
        onConfirm={handleDelete}
        onCancel={() => setDeleting(null)}
      />

      <Dialog
        open={scanOpen}
        onClose={() => {
          setScanOpen(false);
          setScanResults(null);
        }}
        title="Netzwerk nach Reolink-Cams scannen"
        description="Probiert alle IPs im lokalen /24-Subnet mit dem angegebenen Passwort durch (~10 s)."
        size="lg"
      >
        <div className="space-y-4">
          <Field label="Passwort">
            <Input
              type="password"
              value={scanPassword}
              onChange={(e) => setScanPassword(e.target.value)}
              placeholder="Reolink-Admin-Passwort"
              autoFocus
            />
            <Label className="text-xs text-foreground/50">
              Wird gegen jede IP probiert. Nur Cams, die Login akzeptieren, werden gelistet.
            </Label>
          </Field>

          <div className="flex gap-2">
            <Button variant="primary" onClick={runScan} disabled={scanRunning || !scanPassword}>
              {scanRunning ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
              {scanRunning ? "Scanne…" : "Scan starten"}
            </Button>
            {scanResults && scanResults.length > 0 && (
              <Button variant="secondary" onClick={importAll}>
                Alle {scanResults.length} importieren
              </Button>
            )}
          </div>

          {scanResults && scanResults.length === 0 && (
            <div className="rounded-lg bg-tile-accent/40 p-4 text-sm text-foreground/70">
              Keine neuen Cams gefunden. Möglicherweise sind alle bereits konfiguriert oder das
              Passwort stimmt nicht.
            </div>
          )}

          {scanResults && scanResults.length > 0 && (
            <div className="overflow-hidden rounded-xl bg-tile-accent/30 ring-1 ring-border">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wider text-foreground/60">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Modell</th>
                    <th className="px-3 py-2">IP</th>
                    <th className="px-3 py-2 text-right">Aktion</th>
                  </tr>
                </thead>
                <tbody>
                  {scanResults.map((f) => {
                    const known = (REOLINK_MODELS as readonly string[]).includes(f.model);
                    return (
                      <tr key={f.ip} className="border-t border-border">
                        <td className="px-3 py-2 font-medium">{f.name}</td>
                        <td className="px-3 py-2">
                          {f.model}
                          {!known && <span className="ml-1 text-xs text-amber-400">(unbekannt)</span>}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{f.ip}</td>
                        <td className="px-3 py-2 text-right">
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() => importCam(f)}
                            disabled={importing.has(f.ip)}
                          >
                            {importing.has(f.ip) ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <CheckCircle2 className="size-3" />
                            )}
                            Importieren
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Dialog>
    </div>
  );
}
