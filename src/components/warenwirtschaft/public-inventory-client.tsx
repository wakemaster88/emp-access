"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Boxes, CheckCircle2, Plus, ShieldAlert, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Notice } from "@/components/ui/notice";
import { SearchInput } from "@/components/ui/search-input";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";
import { formatQty, parseGermanNumber } from "@/lib/warenwirtschaft";
import { ArticleThumb } from "./article-visual";
import { QtyInput } from "./qty-input";
import { LoadingCard, NameGate, PhotoButton, Shell, StateCard, readCounterName, uploadPhoto } from "./public-count-shared";

interface AssetRow {
  id: number;
  name: string;
  group: string;
  location: string | null;
  deviceNumber: string | null;
  image: string | null;
  quantity: number | null;
  countedBy: string | null;
  previous: number | null;
}

interface Payload {
  /** Blatt des Links, "*" = alle Blätter. */
  group: string;
  groups: string[];
  year: number;
  accountName: string;
  expiresAt: string;
  assets: AssetRow[];
}

type View = "open" | "counted" | "all";
const REFRESH_MS = 30_000;

/**
 * Inventar zählen am Handy (`/zaehlen/inventar/<token>`), ohne Login: alle
 * Blätter (Auswahl oben) oder ein einzelnes, Mengen fürs Zähljahr, Vorjahr als Hilfe.
 * Fehlende Posten und Fotos lassen sich ergänzen.
 */
export function PublicInventoryClient({ token }: { token: string }) {
  const api = `/api/zaehlen/inventar/${token}`;
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [gone, setGone] = useState<string | null>(null);
  const [name, setName] = useState(readCounterName);
  const [view, setView] = useState<View>("open");
  const [q, setQ] = useState("");
  const [location, setLocation] = useState("");
  const [sheet, setSheet] = useState("");
  const [saving, setSaving] = useState(0);
  const [error, setError] = useState("");
  const [invalid, setInvalid] = useState<Set<number>>(new Set());
  const [adding, setAdding] = useState(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch(api, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setGone(body?.error ?? "Dieser Link ist nicht mehr gültig.");
        return;
      }
      if (pending.current === 0) setData(body as Payload);
    } catch {
      /* offline: beim nächsten Abgleich wieder versuchen */
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible" && !document.activeElement?.matches("input[data-count-input]")) void load();
    }, REFRESH_MS);
    const onVisible = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const groups = useMemo(() => data?.groups ?? [], [data]);
  const currentSheet = sheet && groups.includes(sheet) ? sheet : (groups[0] ?? "");
  const allAssets = useMemo(() => data?.assets ?? [], [data]);
  // Zählung und Filter immer je Blatt, wie die Reiter im Büro.
  const assets = useMemo(() => allAssets.filter((a) => a.group === currentSheet), [allAssets, currentSheet]);
  const sheetCounts = useMemo(() => {
    const m = new Map<string, { total: number; done: number }>();
    for (const a of allAssets) {
      const c = m.get(a.group) ?? { total: 0, done: 0 };
      c.total += 1;
      if (a.quantity != null) c.done += 1;
      m.set(a.group, c);
    }
    return m;
  }, [allAssets]);
  const locations = useMemo(() => [...new Set(assets.map((a) => a.location).filter((l): l is string => !!l))].sort(), [assets]);
  const countedCount = assets.filter((a) => a.quantity != null).length;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return assets.filter((a) => {
      if (location && a.location !== location) return false;
      if (needle && !a.name.toLowerCase().includes(needle) && !a.deviceNumber?.toLowerCase().includes(needle)) return false;
      if (view === "open") return a.quantity == null;
      if (view === "counted") return a.quantity != null;
      return true;
    });
  }, [assets, q, location, view]);

  const commit = useCallback(
    (asset: AssetRow, raw: string) => {
      const parsed = parseGermanNumber(raw);
      if (parsed === undefined) {
        setInvalid((s) => new Set(s).add(asset.id));
        setError("Bitte eine Zahl eingeben, z. B. 12 oder 0,5.");
        return;
      }
      setInvalid((s) => {
        const n = new Set(s);
        n.delete(asset.id);
        return n;
      });
      if (parsed === asset.quantity) return;
      setData((d) => d && { ...d, assets: d.assets.map((a) => (a.id === asset.id ? { ...a, quantity: parsed, countedBy: name } : a)) });
      pending.current += 1;
      setSaving((n) => n + 1);
      setError("");
      queue.current = queue.current.then(async () => {
        try {
          const res = await fetch(api, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, counts: [{ assetId: asset.id, quantity: parsed }] }),
          });
          if (res.status === 404 || res.status === 410) {
            const body = await res.json().catch(() => null);
            setGone(body?.error ?? "Dieser Link ist nicht mehr gültig.");
            return;
          }
          if (!res.ok) throw new Error();
        } catch {
          setError("Speichern fehlgeschlagen. Prüfe die Verbindung und gib den Wert erneut ein.");
        } finally {
          pending.current -= 1;
          setSaving((n) => n - 1);
        }
      });
    },
    [api, name],
  );

  async function savePhoto(asset: AssetRow, image: string) {
    const err = await uploadPhoto(`${api}/image`, { name, id: asset.id, image });
    if (err) {
      setError(err);
      return;
    }
    setData((d) => d && { ...d, assets: d.assets.map((a) => (a.id === asset.id ? { ...a, image } : a)) });
  }

  if (gone) {
    return (
      <Shell accountName={data?.accountName}>
        <StateCard icon={ShieldAlert} tone="neutral" title="Zählen nicht möglich" text={gone} />
      </Shell>
    );
  }

  if (loading || !data) {
    return (
      <Shell>
        <LoadingCard />
      </Shell>
    );
  }

  const multi = data.groups.length > 1;
  const title = multi ? "Inventar" : `Inventar ${data.group}`;
  if (!name) {
    return (
      <Shell accountName={data.accountName}>
        <NameGate icon={Boxes} title={title} subtitle={`Zählung ${data.year} · ${multi ? `${data.groups.length} Kategorien · ` : ""}${data.assets.length} Posten`} initial="" onName={setName} />
      </Shell>
    );
  }

  const done = countedCount === assets.length && assets.length > 0;

  return (
    <Shell accountName={data.accountName}>
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-foreground [overflow-wrap:anywhere]">
              {title} · {data.year}
            </h1>
            <p className="text-sm text-muted-foreground tabular-nums">
              {multi && `${currentSheet}: `}
              {countedCount} von {assets.length} gezählt
              {saving > 0 && " · speichert …"}
            </p>
          </div>
          <Button type="button" variant="ghost" size="sm" className="h-11 shrink-0 gap-1.5 text-muted-foreground" onClick={() => setName("")} aria-label={`Name ändern, angemeldet als ${name}`}>
            <UserRound className="h-4 w-4" />
            <span className="max-w-24 truncate">{name}</span>
          </Button>
        </div>

        <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${assets.length ? (countedCount / assets.length) * 100 : 0}%` }} />
        </div>

        <div className="sticky top-0 z-10 -mx-4 space-y-2 border-b border-border bg-background px-4 pb-2 pt-2 shadow-[0_6px_12px_-10px_oklch(0_0_0/25%)]">
          {multi && (
            <NativeSelect
              value={currentSheet}
              onChange={(e) => {
                setSheet(e.target.value);
                setLocation("");
                setQ("");
              }}
              aria-label="Blatt"
              className="h-11 font-medium"
            >
              {data.groups.map((g) => {
                const c = sheetCounts.get(g);
                return (
                  <option key={g} value={g}>
                    {g} ({c?.done ?? 0}/{c?.total ?? 0})
                  </option>
                );
              })}
            </NativeSelect>
          )}
          <div className="flex gap-2">
            <SearchInput value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ("")} placeholder="Suchen" aria-label="Posten suchen" className="h-11" containerClassName="min-w-0 flex-1" />
            {locations.length > 1 && (
              <NativeSelect value={location} onChange={(e) => setLocation(e.target.value)} aria-label="Bereich" className="h-11" containerClassName="w-32 shrink-0">
                <option value="">Alle</option>
                {locations.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </NativeSelect>
            )}
          </div>
          <Segmented
            aria-label="Ansicht"
            size="sm"
            stretch
            value={view}
            onValueChange={setView}
            options={[
              { value: "open", label: "Offen", count: assets.length - countedCount },
              { value: "counted", label: "Gezählt", count: countedCount },
              { value: "all", label: "Alle" },
            ]}
          />
        </div>

        {error && <Notice tone="danger" compact role="alert" title={error} />}

        {filtered.length === 0 ? (
          done && view === "open" && !q && !location ? (
            <StateCard icon={CheckCircle2} tone="success" title="Alles gezählt" text={`Danke! Alle Posten${multi ? ` in ${currentSheet}` : ""} haben eine Menge für ${data.year}.`} />
          ) : (
            <Card className="items-center gap-3 py-8 text-center text-sm text-muted-foreground sm:py-8">
              {q.trim() ? `„${q.trim()}“ ist in dieser Ansicht nicht dabei.` : "Keine Posten in dieser Ansicht"}
              {q.trim() && (
                <Button type="button" variant="outline" className="h-11" onClick={() => setAdding(true)}>
                  <Plus className="h-4 w-4" />
                  Als neuen Posten hinzufügen
                </Button>
              )}
            </Card>
          )
        ) : (
          <Card flush>
            <ul className="divide-y divide-border">
              {filtered.map((a) => (
                <li key={a.id} className="flex min-h-14 items-center gap-2.5 px-3 py-1.5">
                  {a.image ? (
                    <ArticleThumb image={a.image} name={a.name} category="" className="size-11" />
                  ) : (
                    <PhotoButton label={`Foto aufnehmen: ${a.name}`} onError={setError} onPhoto={(img) => savePhoto(a, img)} />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-medium leading-tight text-foreground [overflow-wrap:anywhere]">{a.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[
                        a.location,
                        a.deviceNumber ? `Nr. ${a.deviceNumber}` : null,
                        a.previous != null ? `Vorjahr ${formatQty(a.previous)}` : null,
                        a.quantity != null && a.countedBy ? a.countedBy : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <QtyInput
                    value={a.quantity}
                    field="counted"
                    onCommit={(raw) => commit(a, raw)}
                    label={`Menge ${a.name}`}
                    placeholder="Menge"
                    invalid={invalid.has(a.id)}
                    className={cn("w-[72px] shrink-0 text-base font-medium placeholder:text-xs", a.quantity != null && "border-success/50 bg-success/5")}
                  />
                </li>
              ))}
            </ul>
          </Card>
        )}

        {!(filtered.length === 0 && q.trim()) && (
          <Button type="button" variant="outline" className="h-11 w-full" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" />
            Posten fehlt? Hinzufügen
          </Button>
        )}

        {adding && (
          <AddAssetDialog
            api={api}
            counter={name}
            year={data.year}
            group={currentSheet}
            initialName={q.trim()}
            initialLocation={location}
            locations={locations}
            onClose={() => setAdding(false)}
            onAdded={(row) => {
              setData((d) => d && { ...d, assets: [...d.assets, row] });
              setQ(row.name);
              setLocation("");
              setView("all");
            }}
            onExisting={(id) => {
              const row = assets.find((a) => a.id === id);
              if (row) {
                setQ(row.name);
                setLocation("");
                setView("all");
              }
            }}
          />
        )}

        <p className="pb-4 text-center text-xs text-muted-foreground">
          Eingaben werden sofort gespeichert. Enter springt zum nächsten Posten. Link gültig bis {new Date(data.expiresAt).toLocaleDateString("de-DE")}.
        </p>
      </div>
    </Shell>
  );
}

function AddAssetDialog({
  api,
  counter,
  year,
  group,
  initialName,
  initialLocation,
  locations,
  onClose,
  onAdded,
  onExisting,
}: {
  api: string;
  counter: string;
  year: number;
  group: string;
  initialName: string;
  initialLocation: string;
  locations: string[];
  onClose: () => void;
  onAdded: (row: AssetRow) => void;
  onExisting: (id: number) => void;
}) {
  const [assetName, setAssetName] = useState(initialName);
  const [loc, setLoc] = useState(initialLocation);
  const [qty, setQty] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const quantity = parseGermanNumber(qty);
    if (quantity === undefined) {
      setError("Menge bitte als Zahl eingeben, z. B. 3.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${api}/assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: counter, asset: { name: assetName, group, location: loc || null, quantity } }),
      });
      const body = await res.json().catch(() => null);
      if (res.status === 409 && typeof body?.id === "number") {
        onExisting(body.id);
        onClose();
        return;
      }
      if (!res.ok) {
        setError(typeof body?.error === "string" ? body.error : "Speichern fehlgeschlagen. Prüfe die Verbindung.");
        return;
      }
      onAdded(body as AssetRow);
      onClose();
    } catch {
      setError("Speichern fehlgeschlagen. Prüfe die Verbindung.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Posten hinzufügen</DialogTitle>
            <DialogDescription>
              Neuer Posten im Blatt {group}, gleich mit der Menge für {year}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="asset-name">Bezeichnung</Label>
            <Input id="asset-name" value={assetName} onChange={(e) => setAssetName(e.target.value)} maxLength={200} required className="h-11" placeholder="z. B. Bierzeltgarnitur" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="asset-loc">Bereich</Label>
              <Input id="asset-loc" value={loc} onChange={(e) => setLoc(e.target.value)} maxLength={80} className="h-11" list="asset-locations" placeholder="z. B. Küche" />
              <datalist id="asset-locations">
                {locations.map((l) => (
                  <option key={l} value={l} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="asset-qty">Menge {year}</Label>
              <Input id="asset-qty" value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" className="h-11 text-right tabular-nums" placeholder="Menge" />
            </div>
          </div>
          {error && <Notice tone="danger" compact role="alert" title={error} />}
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11" onClick={onClose}>
              Abbrechen
            </Button>
            <Button type="submit" className="h-11" disabled={busy || !assetName.trim()}>
              Hinzufügen
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
