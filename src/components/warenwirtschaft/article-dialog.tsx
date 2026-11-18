"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Notice } from "@/components/ui/notice";
import { ConfirmStep } from "@/components/ui/confirm-dialog";
import { SearchInput } from "@/components/ui/search-input";
import { resizeImageToDataUrl } from "@/components/lost-items/lost-item-dialog";
import { ArticleThumb } from "./article-visual";
import { ARTICLE_CATEGORIES, OFF_IMAGE_SOURCE, formatQty, parseEuroToCents, parseGermanNumber, type ImageCandidate } from "@/lib/warenwirtschaft";
import { ImagePlus, Loader2, Save, Search, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ArticleData {
  id: number;
  name: string;
  sku: string | null;
  category: string;
  unit: string | null;
  supplier: string | null;
  purchasePriceCents: number | null;
  stock: number;
  image: string | null;
  imageSource: string | null;
  active: boolean;
  note: string | null;
}

function centsToInput(c: number | null): string {
  return c == null ? "" : (c / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
}

function qtyToInput(q: number): string {
  return q.toLocaleString("de-DE", { maximumFractionDigits: 3, useGrouping: false });
}

/** Bildnachweis „Open Food Facts, CC BY-SA 3.0 · https://…“ als Text mit Link. */
export function ImageCredit({ source }: { source: string | null }) {
  if (!source) return null;
  const [label, url] = source.split(" · ");
  return (
    <p className="text-[11px] text-muted-foreground">
      Bild: {url ? <a href={url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">{label}</a> : label}
    </p>
  );
}

export function ArticleDialog({
  article,
  open,
  onClose,
  categories,
}: {
  article: ArticleData | null;
  open: boolean;
  onClose: () => void;
  categories: string[];
}) {
  const router = useRouter();
  const isNew = !article;
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [category, setCategory] = useState("Getränke");
  const [unit, setUnit] = useState("");
  const [supplier, setSupplier] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("");
  const [active, setActive] = useState(true);
  const [note, setNote] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [imageSource, setImageSource] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

  // Bildsuche (Open Food Facts), nur für gespeicherte Artikel.
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [candidates, setCandidates] = useState<ImageCandidate[] | null>(null);

  useEffect(() => {
    if (!open) return;
    setError("");
    setConfirmDelete(false);
    setSearchOpen(false);
    setCandidates(null);
    setName(article?.name ?? "");
    setSku(article?.sku ?? "");
    setCategory(article?.category ?? "Getränke");
    setUnit(article?.unit ?? "");
    setSupplier(article?.supplier ?? "");
    setPrice(centsToInput(article?.purchasePriceCents ?? null));
    setStock(article ? qtyToInput(article.stock) : "");
    setActive(article?.active ?? true);
    setNote(article?.note ?? "");
    setImage(article?.image ?? null);
    setImageSource(article?.imageSource ?? null);
    setQuery(article?.name ?? "");
  }, [open, article]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      setImage(await resizeImageToDataUrl(file, 512));
      setImageSource(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bild konnte nicht verarbeitet werden");
    }
  }

  async function runSearch() {
    if (!article) return;
    setSearching(true);
    setError("");
    try {
      const res = await fetch(`/api/warenwirtschaft/articles/${article.id}/image-search?q=${encodeURIComponent(query)}`);
      const data = await res.json().catch(() => ({}));
      setCandidates(Array.isArray(data.candidates) ? data.candidates : []);
      if (!res.ok && typeof data.error === "string") setError(data.error);
    } catch {
      setCandidates([]);
    } finally {
      setSearching(false);
    }
  }

  async function save() {
    const priceCents = parseEuroToCents(price);
    const stockNum = parseGermanNumber(stock);
    if (!name.trim()) return setError("Name erforderlich");
    if (priceCents === undefined) return setError("Einkaufspreis bitte als Zahl, z. B. 4,49");
    if (stockNum === undefined) return setError("Bestand bitte als Zahl, z. B. 12 oder 0,5");
    setSaving(true);
    setError("");
    try {
      const payload = {
        name: name.trim(),
        sku: sku.trim() || null,
        category: category.trim() || "Sonstiges",
        unit: unit.trim() || null,
        supplier: supplier.trim() || null,
        purchasePriceCents: priceCents,
        stock: stockNum ?? 0,
        active,
        note: note.trim() || null,
        image,
        imageSource,
      };
      const res = await fetch(isNew ? "/api/warenwirtschaft/articles" : `/api/warenwirtschaft/articles/${article!.id}`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(typeof data.error === "string" ? data.error : "Speichern fehlgeschlagen");
      }
      onClose();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Speichern fehlgeschlagen");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    const res = await fetch(`/api/warenwirtschaft/articles/${article!.id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Löschen fehlgeschlagen");
    onClose();
    router.refresh();
  }

  const categoryOptions = [...new Set([...ARTICLE_CATEGORIES, ...categories])];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isNew ? "Artikel anlegen" : "Artikel bearbeiten"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ar-name">Bezeichnung *</Label>
            <Input id="ar-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} placeholder="z. B. Aperol Spritz" className="h-11 sm:h-9" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ar-category">Kategorie</Label>
              <Input id="ar-category" list="ar-categories" value={category} onChange={(e) => setCategory(e.target.value)} maxLength={60} className="h-11 sm:h-9" />
              <datalist id="ar-categories">
                {categoryOptions.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ar-unit">Einheit</Label>
              <Input id="ar-unit" value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={40} placeholder="z. B. FL 0,7 oder Karton" className="h-11 sm:h-9" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ar-price">EK netto (€)</Label>
              <Input id="ar-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0,00" className="h-11 sm:h-9 tabular-nums" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ar-stock">Bestand</Label>
              <Input id="ar-stock" inputMode="decimal" value={stock} onChange={(e) => setStock(e.target.value)} placeholder="0" className="h-11 sm:h-9 tabular-nums" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ar-sku">Artikel-Nr.</Label>
              <Input id="ar-sku" value={sku} onChange={(e) => setSku(e.target.value)} maxLength={60} className="h-11 sm:h-9" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ar-supplier">Lieferant</Label>
              <Input id="ar-supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} maxLength={120} className="h-11 sm:h-9" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Bild</Label>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
            <div className="flex flex-wrap items-start gap-3">
              {image ? (
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element -- Data-URL oder Open-Food-Facts-Adresse */}
                  <img src={image} alt={name || "Artikel"} className="size-24 rounded-tile border border-border bg-white object-contain" />
                  <button
                    type="button"
                    onClick={() => { setImage(null); setImageSource(null); }}
                    className="absolute -top-2.5 -right-2.5 flex size-8 items-center justify-center rounded-full bg-foreground text-background transition-colors after:absolute after:-inset-1.5 after:rounded-full hover:bg-destructive-fill hover:text-white"
                    aria-label="Bild entfernen"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <ArticleThumb image={null} name={name} category={category} className="size-24 [&_svg]:size-8" />
              )}
              <div className="flex flex-col gap-2">
                <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} className="h-11 justify-start gap-1.5 sm:h-9">
                  <ImagePlus className="h-4 w-4" />
                  Foto wählen
                </Button>
                {!isNew && (
                  <Button type="button" variant="outline" onClick={() => { setSearchOpen((v) => !v); if (!candidates) void runSearch(); }} className="h-11 justify-start gap-1.5 sm:h-9">
                    <Search className="h-4 w-4" />
                    Bild suchen
                  </Button>
                )}
              </div>
            </div>
            <ImageCredit source={imageSource} />
          </div>

          {searchOpen && !isNew && (
            <div className="glass-tile space-y-3 p-3">
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void runSearch(); }}>
                <SearchInput value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Suchbegriff" className="h-11 sm:h-9" />
                <Button type="submit" variant="outline" disabled={searching} className="h-11 shrink-0 sm:h-9">
                  {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Suchen"}
                </Button>
              </form>
              {candidates && candidates.length === 0 && !searching && (
                <p className="text-sm text-muted-foreground">Keine Treffer. Versuch einen kürzeren Begriff, z. B. nur die Marke.</p>
              )}
              {candidates && candidates.length > 0 && (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {candidates.map((c) => (
                    <button
                      key={c.code}
                      type="button"
                      onClick={() => { setImage(c.imageUrl); setImageSource(`${OFF_IMAGE_SOURCE} · ${c.productUrl}`); setSearchOpen(false); }}
                      className={cn(
                        "flex min-w-0 flex-col items-center gap-1 rounded-tile border border-border p-1.5 text-left transition-colors hover:border-primary/60",
                        image === c.imageUrl && "border-primary",
                      )}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- fremde Bildadresse */}
                      <img src={c.imageUrl} alt={c.name} loading="lazy" className="aspect-square w-full rounded-lg bg-white object-contain" />
                      <span className="line-clamp-2 w-full text-[11px] leading-tight text-muted-foreground">{c.name || c.brands}</span>
                    </button>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">Fotos aus Open Food Facts (CC BY-SA 3.0), der Nachweis wird gespeichert.</p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="ar-note">Notiz</Label>
            <Textarea id="ar-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} className="resize-none" />
          </div>

          <div className="glass-tile flex items-center gap-3 pl-3">
            <Checkbox id="ar-active" checked={active} onCheckedChange={(c) => setActive(c === true)} />
            <Label htmlFor="ar-active" className="min-h-11 flex-1 cursor-pointer pr-3 text-sm font-medium text-foreground">
              Aktiv (wird in neuen Inventuren gezählt)
            </Label>
          </div>

          {!isNew && article && (
            <p className="text-xs text-muted-foreground">Aktueller Bestand laut letzter Inventur: {formatQty(article.stock)} {article.unit ?? ""}</p>
          )}

          {error && <Notice tone="danger" compact title={error} />}

          {confirmDelete ? (
            <ConfirmStep
              title={`„${article?.name}“ löschen?`}
              description="Abgeschlossene Inventuren behalten ihre Zeile mit Name und Preis."
              confirmLabel="Löschen"
              icon={Trash2}
              onConfirm={remove}
              onCancel={() => setConfirmDelete(false)}
            />
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
