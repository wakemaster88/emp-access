"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Radar, Loader2, Plus, Link2, Server, MonitorSmartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { CLIENT_TYPES } from "@/components/network/network-types";

export interface DiscoveredRow {
  id: number;
  macAddress: string;
  ipAddress: string | null;
  iface: string | null;
  hubName: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  vendor: string | null;
  /// Automatischer MAC-Abgleich gegen verwalteten Bestand.
  match: { kind: "infra" | "client"; name: string } | null;
  /// IP-Treffer bei einem IoT-Geraet (Vorschlag fuer die Uebernahme).
  iotSuggestion: { id: number; name: string } | null;
}

function formatSeen(iso: string): string {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (diffMin < 1) return "gerade eben";
  if (diffMin < 60) return `vor ${diffMin} min`;
  if (diffMin < 60 * 24) return `vor ${Math.floor(diffMin / 60)} h`;
  return new Date(iso).toLocaleDateString("de-DE");
}

type Filter = "all" | "unknown" | "known";

export function DiscoveredTab({ devices }: { devices: DiscoveredRow[] }) {
  const router = useRouter();
  // "Aktiv" = im letzten Scan-Fenster gesehen (15 min Toleranz).
  const activeCutoff = Date.now() - 15 * 60_000;

  const [filter, setFilter] = useState<Filter>("all");
  const [adopting, setAdopting] = useState<DiscoveredRow | null>(null);
  const [form, setForm] = useState({ name: "", type: "OTHER", linkIot: true });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const unknownCount = useMemo(() => devices.filter((d) => !d.match).length, [devices]);

  const filtered = devices.filter((d) => {
    if (filter === "unknown") return !d.match;
    if (filter === "known") return !!d.match;
    return true;
  });

  function openAdopt(d: DiscoveredRow) {
    setAdopting(d);
    setForm({
      name: d.iotSuggestion?.name ?? "",
      type: d.iotSuggestion ? "IOT" : d.vendor?.startsWith("Espressif") ? "IOT" : "OTHER",
      linkIot: !!d.iotSuggestion,
    });
    setError("");
  }

  async function handleAdopt(e: React.FormEvent) {
    e.preventDefault();
    if (!adopting || !form.name.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/network/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          type: form.type,
          ipAddress: adopting.ipAddress,
          macAddress: adopting.macAddress,
          deviceId: form.linkIot && adopting.iotSuggestion ? adopting.iotSuggestion.id : null,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Fehler beim Übernehmen");
      } else {
        setAdopting(null);
        router.refresh();
      }
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setSaving(false);
    }
  }

  const FILTERS: { value: Filter; label: string }[] = [
    { value: "all", label: `Alle (${devices.length})` },
    { value: "unknown", label: `Unbekannt (${unknownCount})` },
    { value: "known", label: `Zugeordnet (${devices.length - unknownCount})` },
  ];

  return (
    <Card className="border-slate-200 dark:border-slate-800">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4">
        <div>
          <CardTitle className="text-base sm:text-xl flex items-center gap-2">
            <Radar className="h-5 w-5 text-violet-500" />
            Vom Hub entdeckte Geräte ({devices.length})
          </CardTitle>
          <p className="text-xs text-slate-500 mt-1">
            Automatischer Netzwerk-Scan des lokalen Hubs. MAC-Abgleich gegen Switches, APs und erfasste Geräte.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-1">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                filter === f.value
                  ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm"
                  : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="p-0 sm:px-6 sm:pb-6">
        {filtered.length === 0 ? (
          <p className="text-sm text-slate-500 px-6 pb-6 sm:px-0">
            {devices.length === 0
              ? "Noch keine Geräte gemeldet. Läuft der Hub und ist das Modul „auto-scan“ aktiv?"
              : "Keine Einträge in diesem Filter."}
          </p>
        ) : (
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-200 dark:border-slate-700 hover:bg-transparent bg-slate-50/80 dark:bg-slate-900/50">
                  <TableHead>Status</TableHead>
                  <TableHead className="min-w-[120px]">IP-Adresse</TableHead>
                  <TableHead className="min-w-[150px]">MAC-Adresse</TableHead>
                  <TableHead className="hidden md:table-cell">Hersteller</TableHead>
                  <TableHead className="min-w-[160px]">Zuordnung</TableHead>
                  <TableHead className="hidden lg:table-cell">Zuletzt gesehen</TableHead>
                  <TableHead className="w-28" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((d) => {
                  const active = new Date(d.lastSeenAt).getTime() > activeCutoff;
                  return (
                    <TableRow key={d.id} className="border-slate-200 dark:border-slate-700">
                      <TableCell>
                        {active ? (
                          <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 gap-1 text-xs h-5">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> aktiv
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-slate-400 gap-1 text-xs h-5">
                            <span className="h-1.5 w-1.5 rounded-full bg-slate-400" /> inaktiv
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-sm">{d.ipAddress ?? "–"}</TableCell>
                      <TableCell className="font-mono text-xs text-slate-500">{d.macAddress}</TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-slate-500">
                        {d.vendor ?? <span className="text-slate-300">–</span>}
                      </TableCell>
                      <TableCell>
                        {d.match ? (
                          <span className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                            {d.match.kind === "infra"
                              ? <Server className="h-3.5 w-3.5 text-indigo-500" />
                              : <MonitorSmartphone className="h-3.5 w-3.5 text-emerald-500" />}
                            {d.match.name}
                          </span>
                        ) : d.iotSuggestion ? (
                          <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                            <Link2 className="h-3 w-3" />
                            vermutlich {d.iotSuggestion.name}
                          </span>
                        ) : (
                          <Badge variant="secondary" className="text-xs text-slate-400">unbekannt</Badge>
                        )}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-sm text-slate-500">
                        {formatSeen(d.lastSeenAt)}
                      </TableCell>
                      <TableCell>
                        {!d.match && (
                          <div className="flex justify-end">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs gap-1"
                              onClick={() => openAdopt(d)}
                            >
                              <Plus className="h-3 w-3" />
                              Übernehmen
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {/* Übernehmen-Dialog */}
      <Dialog open={!!adopting} onOpenChange={(o) => { if (!o) setAdopting(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Gerät übernehmen</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAdopt} className="space-y-4">
            <div className="rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 p-3 text-xs font-mono text-slate-500 space-y-0.5">
              <p>IP: {adopting?.ipAddress ?? "–"}</p>
              <p>MAC: {adopting?.macAddress}</p>
              {adopting?.vendor && <p>Hersteller: {adopting.vendor}</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Name <span className="text-rose-500">*</span></Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="z.B. Kassen-PC Shop"
                required
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>Typ</Label>
              <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CLIENT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {adopting?.iotSuggestion && (
              <label className="flex items-start gap-2 rounded-lg border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/20 p-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.linkIot}
                  onChange={(e) => setForm((f) => ({ ...f, linkIot: e.target.checked }))}
                  className="mt-0.5"
                />
                <span className="text-xs text-amber-800 dark:text-amber-300">
                  Mit IoT-Gerät <strong>{adopting.iotSuggestion.name}</strong> verknüpfen
                  (gleiche IP-Adresse) – Name/Status kommen dann vom Gerät.
                </span>
              </label>
            )}

            {error && (
              <p className="text-sm text-rose-600 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 rounded-lg">{error}</p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setAdopting(null)} disabled={saving}>
                Abbrechen
              </Button>
              <Button
                type="submit"
                disabled={saving || !form.name.trim()}
                className="bg-indigo-600 hover:bg-indigo-700 min-w-28"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Übernehmen"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
