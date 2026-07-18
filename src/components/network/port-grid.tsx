"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, Zap, Cable, MonitorSmartphone, ArrowUp } from "lucide-react";
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
    <div className="space-y-6">
      {/* Port-Matrix wie am physischen Switch */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 p-4">
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
                  "relative flex flex-col items-center justify-center h-14 w-14 rounded-lg border-2 text-xs font-mono font-semibold transition-all hover:scale-105 hover:shadow-md",
                  faulty
                    ? "border-rose-400 bg-rose-50 dark:bg-rose-950/40 text-rose-600"
                    : inactive
                      ? "border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-400"
                      : reserved
                        ? "border-amber-300 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400"
                        : p.uplink
                          ? "border-violet-500 bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"
                          : p.vlan
                            ? cn("border-transparent", vlanColor(p.vlan.id))
                            : "border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300"
                )}
              >
                <span>{p.number}</span>
                <span className="flex items-center gap-0.5 mt-0.5">
                  {p.uplink && <ArrowUp className="h-3 w-3" />}
                  {p.poe && <Zap className="h-3 w-3" />}
                  {p.outlet && <Cable className="h-3 w-3" />}
                  {p.client && <MonitorSmartphone className="h-3 w-3" />}
                </span>
              </button>
            );
          })}
          {ports.length === 0 && (
            <p className="text-sm text-slate-400 py-4">Keine Ports vorhanden.</p>
          )}
        </div>

        {/* Legende */}
        <div className="flex flex-wrap items-center gap-3 mt-4 pt-3 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1 text-violet-600 dark:text-violet-400"><ArrowUp className="h-3 w-3" /> Uplink / Zuleitung</span>
          <span className="inline-flex items-center gap-1"><Zap className="h-3 w-3" /> PoE</span>
          <span className="inline-flex items-center gap-1"><Cable className="h-3 w-3" /> Anschluss verbunden</span>
          <span className="inline-flex items-center gap-1"><MonitorSmartphone className="h-3 w-3" /> Gerät zugewiesen</span>
          <span>Farbe = untagged VLAN</span>
        </div>
      </div>

      {/* Tabellen-Ansicht */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-slate-200 dark:border-slate-700 hover:bg-transparent bg-slate-50/80 dark:bg-slate-900/50">
              <TableHead className="w-16">Port</TableHead>
              <TableHead className="hidden sm:table-cell">Beschriftung</TableHead>
              <TableHead>VLAN</TableHead>
              <TableHead className="hidden md:table-cell">Tagged</TableHead>
              <TableHead className="hidden sm:table-cell">Anschluss</TableHead>
              <TableHead>Gerät</TableHead>
              <TableHead className="hidden lg:table-cell w-20">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ports.map((p) => (
              <TableRow
                key={p.id}
                className="border-slate-200 dark:border-slate-700 cursor-pointer hover:bg-indigo-50/50 dark:hover:bg-indigo-950/20"
                onClick={() => openPort(p)}
              >
                <TableCell className="font-mono font-semibold text-sm">
                  {p.number}
                  {p.poe && <Zap className="inline h-3 w-3 ml-1 text-amber-500" />}
                  {p.uplink && <ArrowUp className="inline h-3 w-3 ml-1 text-violet-500" />}
                </TableCell>
                <TableCell className="hidden sm:table-cell text-sm text-slate-500">
                  <span className="inline-flex items-center gap-1.5">
                    {p.label || <span className="text-slate-300">–</span>}
                    {p.uplink && (
                      <Badge className="bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300 text-[10px] h-4 px-1.5">
                        Uplink
                      </Badge>
                    )}
                  </span>
                </TableCell>
                <TableCell>
                  {p.vlan ? (
                    <Badge className={cn("text-xs", vlanColor(p.vlan.id))}>
                      {p.vlan.vlanId} · {p.vlan.name}
                    </Badge>
                  ) : (
                    <span className="text-xs text-slate-400">–</span>
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
                    <span className="text-xs text-slate-400">–</span>
                  )}
                </TableCell>
                <TableCell className="hidden sm:table-cell text-xs text-slate-500">
                  {p.outlet?.label || <span className="text-slate-300">–</span>}
                </TableCell>
                <TableCell className="text-xs">
                  {p.client ? (
                    <span className="text-slate-700 dark:text-slate-300">{p.client.name}</span>
                  ) : (
                    <span className="text-slate-300">–</span>
                  )}
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  <Badge
                    variant="secondary"
                    className={cn(
                      "text-[10px]",
                      p.status === "FAULTY" && "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
                      p.status === "RESERVED" && "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
                      p.status === "INACTIVE" && "text-slate-400",
                    )}
                  >
                    {PORT_STATUS.find((s) => s.value === p.status)?.label ?? p.status}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Port-Dialog */}
      <Dialog open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null); }}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Port {selected?.number} bearbeiten</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
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
                  <SelectTrigger><SelectValue /></SelectTrigger>
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
                <SelectTrigger><SelectValue placeholder="Kein VLAN" /></SelectTrigger>
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
                        className={cn(
                          "rounded-md border px-2 py-1 text-xs font-mono transition-all",
                          active
                            ? cn("border-transparent", vlanColor(v.id))
                            : "border-slate-200 dark:border-slate-700 text-slate-400 hover:border-slate-300"
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
                <SelectTrigger><SelectValue placeholder="Nicht verbunden" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nicht verbunden</SelectItem>
                  {selectableOutlets.map((o) => (
                    <SelectItem key={o.id} value={String(o.id)}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-800 p-3">
              <div>
                <p className="text-sm font-medium">Uplink / Zuleitung</p>
                <p className="text-xs text-slate-500">Verbindung zu einem anderen Switch/Router</p>
              </div>
              <Switch checked={form.uplink} onCheckedChange={(v) => setForm((f) => ({ ...f, uplink: v }))} />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-800 p-3">
              <div>
                <p className="text-sm font-medium">PoE</p>
                <p className="text-xs text-slate-500">Port liefert Power over Ethernet</p>
              </div>
              <Switch checked={form.poe} onCheckedChange={(v) => setForm((f) => ({ ...f, poe: v }))} />
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
              <p className="text-xs text-slate-400">
                Zugewiesenes Gerät: <span className="text-slate-600 dark:text-slate-300">{selected.client.name}</span>{" "}
                (Zuordnung im Tab &bdquo;Geräte&ldquo; ändern)
              </p>
            )}

            {error && (
              <p className="text-sm text-rose-600 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 rounded-lg">{error}</p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setSelected(null)} disabled={saving}>
                Abbrechen
              </Button>
              <Button type="submit" disabled={saving} className="bg-indigo-600 hover:bg-indigo-700 min-w-28">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Speichern"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
