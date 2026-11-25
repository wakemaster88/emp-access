"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SearchInput } from "@/components/ui/search-input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArticleDialog, type ArticleData } from "./article-dialog";
import { ArticleThumb } from "./article-visual";
import { formatEuro, formatQty, valueCents } from "@/lib/warenwirtschaft";
import { Boxes, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/** „Artikel anlegen“ im Kartenkopf; auf dem Handy kurz „Artikel“. */
export function CreateArticleButton({ categories }: { categories: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)} className="max-sm:h-11" aria-label="Artikel anlegen">
        <Plus className="h-4 w-4" />
        <span>Artikel<span className="max-sm:sr-only"> anlegen</span></span>
      </Button>
      <ArticleDialog article={null} open={open} onClose={() => setOpen(false)} categories={categories} />
    </>
  );
}

export function ArticlesView({ articles, categories, canDelete }: { articles: ArticleData[]; categories: string[]; canDelete: boolean }) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [selected, setSelected] = useState<ArticleData | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return articles.filter(
      (a) =>
        (!category || a.category === category) &&
        (!needle || a.name.toLowerCase().includes(needle) || a.sku?.toLowerCase().includes(needle) || a.supplier?.toLowerCase().includes(needle)),
    );
  }, [articles, q, category]);

  return (
    <>
      <div className="flex flex-col gap-2 px-4 pb-4 sm:flex-row sm:px-[18px]">
        <SearchInput value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ("")} placeholder="Artikel, Nummer oder Lieferant" aria-label="Artikel suchen" className="h-11 sm:h-9" />
        <NativeSelect value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Kategorie" containerClassName="sm:w-52" className="h-11 sm:h-9">
          <option value="">Alle Kategorien</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </NativeSelect>
      </div>

      <div className="border-t border-border">
        <Table edge>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">Bild</TableHead>
              <TableHead>Artikel</TableHead>
              <TableHead className="hidden w-32 md:table-cell">Kategorie</TableHead>
              <TableHead className="hidden w-28 text-right sm:table-cell">EK netto</TableHead>
              <TableHead className="w-24 text-right">Bestand</TableHead>
              <TableHead className="hidden w-28 text-right md:table-cell">Wert</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableEmpty colSpan={6} icon={Boxes} title={articles.length === 0 ? "Noch keine Artikel angelegt" : "Keine Artikel für diese Suche"} compact={false} />
            )}
            {filtered.map((a) => (
              <TableRow key={a.id} className="cursor-pointer" onClick={() => setSelected(a)}>
                <TableCell>
                  <ArticleThumb image={a.image} name={a.name} category={a.category} className={cn(!a.active && "opacity-60")} />
                </TableCell>
                <TableCell className="max-w-0 w-full whitespace-normal">
                  <p className="font-medium text-foreground [overflow-wrap:anywhere]">{a.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {[a.unit, a.sku ? `Nr. ${a.sku}` : null].filter(Boolean).join(" · ") || "–"}
                    <span className="sm:hidden"> · {formatEuro(a.purchasePriceCents)}</span>
                  </p>
                  {!a.active && <Badge variant="neutral" className="mt-1">Inaktiv</Badge>}
                </TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">{a.category}</TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">{formatEuro(a.purchasePriceCents)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{formatQty(a.stock)}</TableCell>
                <TableCell className="hidden text-right tabular-nums text-muted-foreground md:table-cell">
                  {formatEuro(valueCents(a.stock, a.purchasePriceCents))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ArticleDialog article={selected} open={!!selected} onClose={() => setSelected(null)} categories={categories} canDelete={canDelete} />
    </>
  );
}
