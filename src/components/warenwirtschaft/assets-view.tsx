"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Notice } from "@/components/ui/notice";
import { SearchInput } from "@/components/ui/search-input";
import { NativeSelect } from "@/components/ui/native-select";
import { ConfirmStep } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { assetYears, formatQty, parseGermanNumber } from "@/lib/warenwirtschaft";
import { Archive, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ArticleThumb } from "./article-visual";

export interface AssetData {
  id: number;
  name: string;
  group: string;
  location: string | null;
  deviceNumber: string | null;
  lastInspection: string | null;
  note: string | null;
  image?: string | null;
  counts: Record<number, number>;
}

function fmtDate(s: string | null): string {
  return s ? new Date(s).toLocaleDateString("de-DE", { timeZone: "UTC" }) : "–";
}

function toInput(v: number | undefined): string {
  return v == null ? "" : v.toLocaleString("de-DE", { maximumFractionDigits: 3, useGrouping: false });
}


function AssetDialog({
  asset,
  open,
  onClose,
  group,
  groups,
  locations,
  years,
}: {
  asset: AssetData | null;
  open: boolean;
  onClose: () => void;
  group: string;
  groups: string[];
  locations: string[];
  years: number[];
}) {
  const router = useRouter();
  const isNew = !asset;
  const [name, setName] = useState("");
  const [grp, setGrp] = useState(group);
  const [location, setLocation] = useState("");
  const [deviceNumber, setDeviceNumber] = useState("");
  const [lastInspection, setLastInspection] = useState("");
  const [note, setNote] = useState("");
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    setConfirmDelete(false);
    setName(asset?.name ?? "");
    setGrp(asset?.group ?? group);
    setLocation(asset?.location ?? "");
    setDeviceNumber(asset?.deviceNumber ?? "");
    setLastInspection(asset?.lastInspection?.slice(0, 10) ?? "");
    setNote(asset?.note ?? "");
    setCounts(Object.fromEntries(years.map((y) => [y, toInput(asset?.counts[y])])));
  }, [open, asset, group, years]);

  async function save() {
    if (!name.trim()) return setError("Bezeichnung erforderlich");
    const parsed = years.map((y) => ({ year: y, quantity: parseGermanNumber(counts[y] ?? "") }));
    if (parsed.some((c) => c.quantity === undefined)) return setError("Mengen bitte als Zahl eingeben");
    setSaving(true);
    setError("");
    try {
      const res = await fetch(isNew ? "/api/warenwirtschaft/assets" : `/api/warenwirtschaft/assets/${asset!.id}`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          group: grp,
          location: location.trim() || null,
          deviceNumber: deviceNumber.trim() || null,
          lastInspection: lastInspection || null,
          note: note.trim() || null,
          counts: parsed,
        }),
      });
      if (!res.ok) throw new Error("Speichern fehlgeschlagen");
      onClose();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Speichern fehlgeschlagen");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    const res = await fetch(`/api/warenwirtschaft/assets/${asset!.id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Löschen fehlgeschlagen");
    onClose();
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isNew ? "Inventar anlegen" : "Inventar bearbeiten"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="as-name">Bezeichnung *</Label>
            <Input id="as-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} placeholder="z. B. Eistruhe" className="h-11 sm:h-9" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="as-group">Blatt</Label>
              <NativeSelect id="as-group" value={grp} onChange={(e) => setGrp(e.target.value)} className="h-11 sm:h-9">
                {groups.map((g) => <option key={g} value={g}>{g}</option>)}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="as-location">Bereich</Label>
              <Input id="as-location" list="as-locations" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={80} placeholder="z. B. Restaurant" className="h-11 sm:h-9" />
              <datalist id="as-locations">{locations.map((l) => <option key={l} value={l} />)}</datalist>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="as-device">Gerätenummer</Label>
              <Input id="as-device" value={deviceNumber} onChange={(e) => setDeviceNumber(e.target.value)} maxLength={80} className="h-11 sm:h-9" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="as-insp">Letzte Prüfung</Label>
              <Input id="as-insp" type="date" value={lastInspection} onChange={(e) => setLastInspection(e.target.value)} className="h-11 sm:h-9" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label id="as-counts">Menge je Inventur</Label>
            <div role="group" aria-labelledby="as-counts" className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {years.map((y) => (
                <div key={y} className="space-y-1">
                  <Label htmlFor={`as-c-${y}`} className="text-xs text-muted-foreground">{y}</Label>
                  <Input
                    id={`as-c-${y}`}
                    inputMode="decimal"
                    value={counts[y] ?? ""}
                    onChange={(e) => setCounts((c) => ({ ...c, [y]: e.target.value }))}
                    className="h-11 text-right tabular-nums sm:h-9"
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="as-note">Notiz</Label>
            <Textarea id="as-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} className="resize-none" />
          </div>
          {error && <Notice tone="danger" compact title={error} />}
          {confirmDelete ? (
            <ConfirmStep title={`„${asset?.name}“ löschen?`} description="Die Mengen aller Jahre werden mit gelöscht." confirmLabel="Löschen" icon={Trash2} onConfirm={remove} onCancel={() => setConfirmDelete(false)} />
          ) : (
            <DialogFooter
              className="pt-2"
              start={!isNew ? (
                <Button type="button" variant="ghost" onClick={() => setConfirmDelete(true)} disabled={saving} className="h-11 gap-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive sm:h-9">
                  <Trash2 className="h-4 w-4" />
                  Löschen
                </Button>
              ) : null}
            >
              <Button type="button" variant="outline" onClick={onClose} disabled={saving} className="h-11 sm:h-9">Abbrechen</Button>
              <Button type="button" onClick={save} disabled={saving} className="h-11 gap-1.5 sm:h-9">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Speichern
              </Button>
            </DialogFooter>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Mengenfeld der Zähljahr-Spalte: speichert beim Verlassen. */
function CountCell({ asset, year, onSaved }: { asset: AssetData; year: number; onSaved: (q: number | null) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  async function commit(raw: string) {
    const q = parseGermanNumber(raw);
    if (q === undefined) return setState("error");
    if ((q ?? undefined) === asset.counts[year]) return setState("idle");
    setState("saving");
    try {
      const res = await fetch(`/api/warenwirtschaft/assets/${asset.id}/count`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, quantity: q }),
      });
      if (!res.ok) throw new Error();
      onSaved(q);
      setState("idle");
    } catch {
      setState("error");
    }
  }
  return (
    <Input
      inputMode="decimal"
      aria-label={`Menge ${year} ${asset.name}`}
      aria-invalid={state === "error" || undefined}
      value={draft ?? toInput(asset.counts[year])}
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== null) void commit(draft);
        setDraft(null);
      }}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      className={cn("ml-auto h-11 w-20 px-2 text-right tabular-nums sm:h-9", state === "saving" && "opacity-60")}
    />
  );
}

export function CreateAssetButton(props: { group: string; groups: string[]; locations: string[]; years: number[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)} className="max-sm:h-11" aria-label="Inventar anlegen">
        <Plus className="h-4 w-4" />
        <span>Eintrag<span className="max-sm:sr-only"> anlegen</span></span>
      </Button>
      <AssetDialog asset={null} open={open} onClose={() => setOpen(false)} {...props} />
    </>
  );
}

export function AssetsView({
  assets: initial,
  group,
  groups,
  defaultYear,
}: {
  assets: AssetData[];
  group: string;
  groups: string[];
  defaultYear: number;
}) {
  const [assets, setAssets] = useState(initial);
  useEffect(() => setAssets(initial), [initial]);
  const [q, setQ] = useState("");
  const [location, setLocation] = useState("");
  const [year, setYear] = useState(defaultYear);
  const [selected, setSelected] = useState<AssetData | null>(null);

  const years = useMemo(() => assetYears(assets, defaultYear), [assets, defaultYear]);
  const locations = useMemo(() => [...new Set(assets.map((a) => a.location).filter((l): l is string => !!l))].sort((a, b) => a.localeCompare(b, "de")), [assets]);
  const prevYears = years.filter((y) => y < year).slice(-3);
  const prev = prevYears[prevYears.length - 1];

  const filtered = assets.filter((a) => {
    if (location && a.location !== location) return false;
    const needle = q.trim().toLowerCase();
    return !needle || a.name.toLowerCase().includes(needle) || a.deviceNumber?.toLowerCase().includes(needle);
  });
  const counted = filtered.filter((a) => a.counts[year] != null).length;

  return (
    <>
      <div className="flex flex-col gap-2 px-4 pb-4 sm:flex-row sm:px-[18px]">
        <SearchInput value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ("")} placeholder="Suchen" aria-label="Inventar suchen" className="h-11 sm:h-9" />
        {locations.length > 1 && (
          <NativeSelect value={location} onChange={(e) => setLocation(e.target.value)} aria-label="Bereich" containerClassName="sm:w-44" className="h-11 sm:h-9">
            <option value="">Alle Bereiche</option>
            {locations.map((l) => <option key={l} value={l}>{l}</option>)}
          </NativeSelect>
        )}
        <NativeSelect value={String(year)} onChange={(e) => setYear(Number(e.target.value))} aria-label="Zähljahr" containerClassName="sm:w-36" className="h-11 sm:h-9">
          {[...new Set([...years, defaultYear + 1])].sort((a, b) => b - a).map((y) => <option key={y} value={y}>Zählung {y}</option>)}
        </NativeSelect>
      </div>
      <p className="px-4 pb-3 text-xs text-muted-foreground sm:px-[18px]">
        {counted} von {filtered.length} Einträgen für {year} gezählt. Menge eintragen und Feld verlassen speichert sofort.
      </p>

      <div className="border-t border-border">
        <Table edge>
          <TableHeader>
            <TableRow>
              <TableHead>Artikel</TableHead>
              <TableHead className="hidden w-36 md:table-cell">Bereich</TableHead>
              <TableHead className="hidden w-28 lg:table-cell">Letzte Prüfung</TableHead>
              {prevYears.map((y) => (
                <TableHead key={y} className={cn("w-16 text-right", y === prev ? "hidden sm:table-cell" : "hidden lg:table-cell")}>{y}</TableHead>
              ))}
              <TableHead className="w-24 text-right">{year}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && <TableEmpty colSpan={4 + prevYears.length} icon={Archive} title={`Noch kein Inventar unter „${group}“`} compact={false} />}
            {filtered.map((a) => (
              <TableRow key={a.id} className="cursor-pointer" onClick={() => setSelected(a)}>
                <TableCell className="max-w-0 w-full whitespace-normal">
                  <div className="flex items-center gap-2.5">
                    {a.image && <ArticleThumb image={a.image} name={a.name} category="" className="size-9" />}
                    <div className="min-w-0">
                      <p className="font-medium text-foreground [overflow-wrap:anywhere]">{a.name}</p>
                      <p className="text-xs text-muted-foreground">
                        <span className="md:hidden">{a.location ?? "–"}</span>
                        {a.deviceNumber && <span> · Nr. {a.deviceNumber}</span>}
                        {prev != null && <span className="sm:hidden"> · {prev}: {formatQty(a.counts[prev])}</span>}
                      </p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">{a.location ?? "–"}</TableCell>
                <TableCell className="hidden tabular-nums text-muted-foreground lg:table-cell">{fmtDate(a.lastInspection)}</TableCell>
                {prevYears.map((y) => (
                  <TableCell key={y} className={cn("text-right tabular-nums text-muted-foreground", y === prev ? "hidden sm:table-cell" : "hidden lg:table-cell")}>
                    {formatQty(a.counts[y])}
                  </TableCell>
                ))}
                <TableCell className="text-right">
                  <CountCell
                    key={`${a.id}-${year}`}
                    asset={a}
                    year={year}
                    onSaved={(qty) =>
                      setAssets((list) =>
                        list.map((x) => {
                          if (x.id !== a.id) return x;
                          const c = { ...x.counts };
                          if (qty == null) delete c[year];
                          else c[year] = qty;
                          return { ...x, counts: c };
                        }),
                      )
                    }
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AssetDialog asset={selected} open={!!selected} onClose={() => setSelected(null)} group={group} groups={groups} locations={locations} years={years} />
    </>
  );
}

