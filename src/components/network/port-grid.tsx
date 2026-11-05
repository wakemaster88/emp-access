"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { Loader2, Zap, Cable, MonitorSmartphone, ArrowUp, EthernetPort, Lock, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { PORT_STATUS, vlanColor } from "@/components/network/network-types";

export interface PortData {
  id: number;
  number: number;
  label: string | null;
  poe: boolean;
  uplink: boolean;
  status: string;
  notes: string | null;
  vlan: { id: number; vlanId: number; name: string } | null;
  taggedVlans: { id: number; vlanId: number; name: string }[];
  outlet: { id: number; label: string } | null;
  client: { id: number; name: string } | null;
}

interface VlanOption { id: number; vlanId: number; name: string }
interface OutletOption { id: number; label: string; taken: boolean }

// Port-Status als Zustandsfarbe: aktiv = grün, inaktiv = ruhig, reserviert = Hinweis,
// defekt = Störung (docs/design-regeln.md, Abschnitt 3). Unbekannte Werte bleiben Glas.
const PORT_STATUS_VARIANT: Record<string, "success" | "neutral" | "warning" | "danger"> = {
  ACTIVE: "success",
  INACTIVE: "neutral",
  RESERVED: "warning",
  FAULTY: "danger",
};

interface PortGridProps {
  ports: PortData[];
  vlans: VlanOption[];
  outlets: OutletOption[];
}

export function PortGrid({ ports, vlans, outlets }: PortGridProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<PortData | null>(null);
  const [form, setForm] = useState({
    label: "",
    vlanId: "none",
    taggedVlanIds: [] as number[],
    outletId: "none",
    poe: false,
    uplink: false,
    status: "ACTIVE",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function openPort(p: PortData) {
    setSelected(p);
    setForm({
      label: p.label ?? "",
      vlanId: p.vlan ? String(p.vlan.id) : "none",
      taggedVlanIds: p.taggedVlans.map((v) => v.id),
      outletId: p.outlet ? String(p.outlet.id) : "none",
      poe: p.poe,
      uplink: p.uplink,
      status: p.status,
      notes: p.notes ?? "",
    });
    setError("");
  }

  function toggleTagged(vlanDbId: number) {
    setForm((f) => ({
      ...f,
      taggedVlanIds: f.taggedVlanIds.includes(vlanDbId)
        ? f.taggedVlanIds.filter((id) => id !== vlanDbId)
        : [...f.taggedVlanIds, vlanDbId],
    }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/network/ports/${selected.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: form.label,
          vlanId: form.vlanId === "none" ? null : Number(form.vlanId),
          taggedVlanIds: form.taggedVlanIds,
          outletId: form.outletId === "none" ? null : Number(form.outletId),
          poe: form.poe,
          uplink: form.uplink,
          status: form.status,
          notes: form.notes,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Fehler beim Speichern");
      } else {
        setSelected(null);
        router.refresh();
      }
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setSaving(false);
    }
  }

  const selectableOutlets = outlets.filter(
    (o) => !o.taken || (selected?.outlet && o.id === selected.outlet.id)
  );

  return (
    <div className="space-y-4">
      {ports.length === 0 ? (
        // Ohne Ports nur der leere Zustand: keine Legende und kein leerer Tabellenkopf
        // (docs/design-regeln.md, Abschnitte 1 und 19).
        <EmptyState compact icon={EthernetPort} title="Keine Ports vorhanden." />
      ) : (
        <>
          {/* Port-Matrix wie am physischen Switch */}
          <div className="glass-tile p-4">
            <div className="flex flex-wrap gap-2">
              {ports.map((p) => {
                const inactive = p.status === "INACTIVE";
                const faulty = p.status === "FAULTY";
                const reserved = p.status === "RESERVED";
                return (
                  <button
                    key={p.id}
                    onClick={() => openPort(p)}
                    title={[
                      `Port ${p.number}`,
                      p.uplink ? "Uplink / Zuleitung" : null,
                      p.label,
                      p.vlan ? `VLAN ${p.vlan.vlanId} (${p.vlan.name})` : null,
                      p.client ? `Gerät: ${p.client.name}` : null,
                      p.outlet ? `Dose: ${p.outlet.label}` : null,
                    ].filter(Boolean).join(" · ")}
                    className={cn(
                      "press relative flex flex-col items-center justify-center h-14 w-14 rounded-control border text-xs font-mono font-semibold outline-none hover:-translate-y-0.5 focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      // Uplink ist eine Rolle, kein Zustand: Akzentfarbe mit vollem Rand,
                      // damit er sich von den getönten VLAN-Ports abhebt. Die Portnummer steht
                      // wie bei den VLAN-Ports in Schriftfarbe auf der Tönung; Rand und Symbol
                      // tragen die Zustandsfarbe (farbige Schrift auf eigener Tönung lag bei
                      // 3,0–4,2 : 1; docs/design-regeln.md, Abschnitt 10 verlangt 4,5 : 1).
                      faulty
                        ? "border-destructive/45 bg-destructive/12 text-foreground"
                        : inactive
                          ? "border-border bg-muted/60 text-muted-foreground"
                          : reserved
                            ? "border-warning/45 bg-warning/12 text-foreground"
                            : p.uplink
                              ? "border-primary bg-primary/12 text-foreground"
                              : p.vlan
                                ? vlanColor(p.vlan.id, vlans)
                                : "border-border bg-glass-tile text-muted-foreground"
                    )}
                  >
                    <span>{p.number}</span>
                    {/* Reserviert und Defekt tragen zusätzlich ein Symbol: die VLAN-Farben aus den
                        Diagramm-Tokens liegen nahe an den Zustandsfarben (docs/design-regeln.md,
                        Abschnitt 12). PoE ist eine Eigenschaft und übernimmt die Schriftfarbe. */}
                    <span className="flex items-center gap-0.5 mt-0.5">
                      {reserved && <Lock className="h-3 w-3 text-warning" />}
                      {faulty && <AlertTriangle className="h-3 w-3 text-destructive" />}
                      {p.uplink && <ArrowUp className="h-3 w-3 text-primary" />}
                      {p.poe && <Zap className="h-3 w-3" />}
                      {p.outlet && <Cable className="h-3 w-3" />}
                      {p.client && <MonitorSmartphone className="h-3 w-3" />}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Legende */}
            <div className="flex flex-wrap items-center gap-3 mt-4 pt-3 border-t border-border text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1"><ArrowUp className="h-3 w-3 text-primary" /> Uplink / Zuleitung</span>
              <span className="inline-flex items-center gap-1"><Lock className="h-3 w-3 text-warning" /> Reserviert</span>
              <span className="inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-destructive" /> Defekt</span>
              <span className="inline-flex items-center gap-1"><Zap className="h-3 w-3" /> PoE</span>
              <span className="inline-flex items-center gap-1"><Cable className="h-3 w-3" /> Anschluss verbunden</span>
              <span className="inline-flex items-center gap-1"><MonitorSmartphone className="h-3 w-3" /> Gerät zugewiesen</span>
              <span>Farbe = untagged VLAN</span>
            </div>
          </div>

          {/* Tabellen-Ansicht: läuft bis an die Kartenränder (docs/design-regeln.md, Abschnitt 17). */}
          <div className="-mx-4 sm:-mx-[18px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16 pl-4 sm:pl-[18px]">Port</TableHead>
                  <TableHead className="hidden sm:table-cell">Beschriftung</TableHead>
                  <TableHead>VLAN</TableHead>
                  <TableHead className="hidden md:table-cell">Tagged</TableHead>
                  <TableHead className="hidden sm:table-cell">Anschluss</TableHead>
                  <TableHead className="pr-4 sm:pr-[18px] lg:pr-2">Gerät</TableHead>
                  <TableHead className="hidden lg:table-cell w-20 pr-4 sm:pr-[18px]">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ports.map((p) => (
                  <TableRow
                    key={p.id}
                    className="cursor-pointer max-sm:h-11"
                    onClick={() => openPort(p)}
                  >
                    <TableCell className="pl-4 sm:pl-[18px] font-mono font-semibold text-sm">
                      {p.number}
                      {p.poe && <Zap className="inline h-3 w-3 ml-1 text-muted-foreground" />}
                      {p.uplink && <ArrowUp className="inline h-3 w-3 ml-1 text-primary" />}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        {p.label || <span className="text-muted-foreground">–</span>}
                        {p.uplink && <Badge variant="outline">Uplink</Badge>}
                      </span>
                    </TableCell>
                    <TableCell>
                      {p.vlan ? (
                        <Badge className={vlanColor(p.vlan.id, vlans)}>
                          {p.vlan.vlanId} · {p.vlan.name}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">–</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {p.taggedVlans.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {p.taggedVlans.map((v) => (
                            <Badge key={v.id} variant="secondary" className="text-[10px] font-mono">
                              {v.vlanId}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">–</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
                      {p.outlet?.label || <span className="text-muted-foreground">–</span>}
                    </TableCell>
                    <TableCell className="text-xs pr-4 sm:pr-[18px] lg:pr-2">
                      {p.client ? (
                        <span className="text-foreground/80">{p.client.name}</span>
                      ) : (
                        <span className="text-muted-foreground">–</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell pr-4 sm:pr-[18px]">
                      <Badge variant={PORT_STATUS_VARIANT[p.status] ?? "secondary"} className="text-[10px]">
                        {PORT_STATUS.find((s) => s.value === p.status)?.label ?? p.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      {/* Port-Dialog */}
      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Port {selected?.number} bearbeiten</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Beschriftung</Label>
                <Input
                  value={form.label}
                  onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                  placeholder="z.B. Uplink"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PORT_STATUS.map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Untagged VLAN (PVID)</Label>
              <Select value={form.vlanId} onValueChange={(v) => setForm((f) => ({ ...f, vlanId: v }))}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Kein VLAN" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Kein VLAN</SelectItem>
                  {vlans.map((v) => (
                    <SelectItem key={v.id} value={String(v.id)}>{v.vlanId} · {v.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {vlans.length > 0 && (
              <div className="space-y-1.5">
                <Label>Tagged VLANs (Trunk)</Label>
                <div className="flex flex-wrap gap-1.5">
                  {vlans.map((v) => {
                    const active = form.taggedVlanIds.includes(v.id);
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => toggleTagged(v.id)}
                        aria-pressed={active}
                        className={cn(
                          "press inline-flex h-8 items-center rounded-full border px-3 text-xs font-mono outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 max-sm:h-11",
                          active
                            ? vlanColor(v.id, vlans)
                            : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground"
                        )}
                      >
                        {v.vlanId} · {v.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Verbunden mit Anschluss</Label>
              <Select value={form.outletId} onValueChange={(v) => setForm((f) => ({ ...f, outletId: v }))}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Nicht verbunden" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nicht verbunden</SelectItem>
                  {selectableOutlets.map((o) => (
                    <SelectItem key={o.id} value={String(o.id)}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="glass-tile flex items-center justify-between gap-3 p-3">
              <div>
                <p className="text-sm font-medium">Uplink / Zuleitung</p>
                <p className="text-xs text-muted-foreground">Verbindung zu einem anderen Switch/Router</p>
              </div>
              <Switch aria-label="Uplink / Zuleitung" checked={form.uplink} onCheckedChange={(v) => setForm((f) => ({ ...f, uplink: v }))} />
            </div>

            <div className="glass-tile flex items-center justify-between gap-3 p-3">
              <div>
                <p className="text-sm font-medium">PoE</p>
                <p className="text-xs text-muted-foreground">Port liefert Power over Ethernet</p>
              </div>
              <Switch aria-label="PoE" checked={form.poe} onCheckedChange={(v) => setForm((f) => ({ ...f, poe: v }))} />
            </div>

            <div className="space-y-1.5">
              <Label>Notizen</Label>
              <Input
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="optional"
              />
            </div>

            {selected?.client && (
              <p className="text-xs text-muted-foreground">
                Zugewiesenes Gerät: <span className="text-foreground">{selected.client.name}</span>{" "}
                (Zuordnung im Tab &bdquo;Geräte&ldquo; ändern)
              </p>
            )}

            {error && <Notice tone="danger" compact title={error} />}

            <DialogFooter className="pt-1">
              <Button type="button" variant="outline" onClick={() => setSelected(null)} disabled={saving}>
                Abbrechen
              </Button>
              <Button type="submit" disabled={saving} className="min-w-28">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Speichern"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
