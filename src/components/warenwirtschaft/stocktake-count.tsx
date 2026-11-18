"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { StatCard } from "@/components/ui/stat-card";
import { Segmented } from "@/components/ui/segmented";
import { SearchInput } from "@/components/ui/search-input";
import { NativeSelect } from "@/components/ui/native-select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArticleThumb } from "./article-visual";
import { QtyInput, type Field } from "./qty-input";
import { StocktakeLinkCard } from "./stocktake-link-card";
import { formatEuro, formatQty, parseGermanNumber, stocktakeTotals, totalsByCategory, valueCents } from "@/lib/warenwirtschaft";
import { AlertTriangle, CheckCircle2, ClipboardList, Download, Euro, Lock, Trash2 } from "lucide-react";

export interface CountLine {
  id: number;
  name: string;
  sku: string | null;
  category: string;
  unit: string | null;
  purchasePriceCents: number | null;
  expected: number;
  counted: number | null;
  broken: number | null;
  countedBy: string | null;
  image: string | null;
}

export interface StocktakeInfo {
  id: number;
  kind: "ROLLING" | "CUTOFF";
  title: string;
  date: string;
  status: "OPEN" | "CLOSED";
  closedAt: string | null;
  closedBy: string | null;
  countToken: string | null;
  countTokenExpiresAt: string | null;
}

type View = "all" | "open" | "counted" | "diff";
export function StocktakeCount({ info, initialLines, listPath }: { info: StocktakeInfo; initialLines: CountLine[]; listPath: string }) {
  const router = useRouter();
  const cutoff = info.kind === "CUTOFF";
  const closed = info.status === "CLOSED";
  const [lines, setLines] = useState(initialLines);
  const [view, setView] = useState<View>("all");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [saving, setSaving] = useState(0);
  const [error, setError] = useState("");
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const queue = useRef<Promise<void>>(Promise.resolve());

  // Laufende Speichervorgänge, für die Effekte unten (State wäre dort veraltet).
  const savingRef = useRef(0);

  // Neuer Serverstand (z. B. Zählungen vom Handy) übernehmen, außer während gespeichert wird.
  useEffect(() => {
    if (savingRef.current === 0) setLines(initialLines);
  }, [initialLines]);

  // Offene Inventur: alle 30 Sekunden abgleichen, damit Zählungen vom Handy hier erscheinen.
  useEffect(() => {
    if (closed) return;
    const t = setInterval(() => {
      if (document.visibilityState !== "visible" || savingRef.current > 0) return;
      if (document.activeElement?.matches("input[data-count-input]")) return;
      router.refresh();
    }, 30_000);
    return () => clearInterval(t);
  }, [closed, router]);

  const categories = useMemo(() => [...new Set(initialLines.map((l) => l.category))], [initialLines]);
  const totals = stocktakeTotals(lines);
  const byCategory = totalsByCategory(lines);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return lines.filter((l) => {
      if (category && l.category !== category) return false;
      if (needle && !l.name.toLowerCase().includes(needle) && !l.sku?.toLowerCase().includes(needle)) return false;
      if (view === "open") return l.counted == null;
      if (view === "counted") return l.counted != null;
      if (view === "diff") return l.counted != null && l.counted !== l.expected;
      return true;
    });
  }, [lines, q, category, view]);

  const commit = useCallback(
    (line: CountLine, field: Field, raw: string) => {
      const key = `${line.id}-${field}`;
      const parsed = parseGermanNumber(raw);
      if (parsed === undefined) {
        setInvalid((s) => new Set(s).add(key));
        setError("Bitte eine Zahl eingeben, z. B. 12 oder 0,5.");
        return;
      }
      setInvalid((s) => {
        const n = new Set(s);
        n.delete(key);
        return n;
      });
      if (parsed === line[field]) return;
      setLines((prev) => prev.map((l) => (l.id === line.id ? { ...l, [field]: parsed } : l)));
      savingRef.current += 1;
      setSaving((n) => n + 1);
      setError("");
      // Nacheinander speichern, damit eine spätere Eingabe nicht überholt wird.
      queue.current = queue.current.then(async () => {
        try {
          const res = await fetch(`/api/warenwirtschaft/stocktakes/${info.id}/lines`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lines: [{ id: line.id, [field]: parsed }] }),
          });
          if (!res.ok) throw new Error();
        } catch {
          setError("Speichern fehlgeschlagen. Prüfe die Verbindung und gib den Wert erneut ein.");
        } finally {
          savingRef.current -= 1;
          setSaving((n) => n - 1);
        }
      });
    },
    [info.id],
  );

  async function close() {
    await queue.current;
    const res = await fetch(`/api/warenwirtschaft/stocktakes/${info.id}/close`, { method: "POST" });
    if (!res.ok) throw new Error("Festschreiben fehlgeschlagen");
    router.refresh();
  }

  async function remove() {
    const res = await fetch(`/api/warenwirtschaft/stocktakes/${info.id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Verwerfen fehlgeschlagen");
    router.push(listPath);
    router.refresh();
  }

  const open = lines.length - totals.counted;
  const dateLabel = new Date(info.date).toLocaleDateString("de-DE", { timeZone: "UTC" });

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Gezählt" value={`${totals.counted}/${totals.lines}`} icon={ClipboardList} tone="primary" progress={totals.lines ? totals.counted / totals.lines : 0} />
        <StatCard label="Lagerwert netto" value={formatEuro(totals.valueCents)} icon={Euro} tone="success" />
        <StatCard label="Bruch" value={formatEuro(totals.brokenCents)} icon={AlertTriangle} tone={totals.brokenCents > 0 ? "warning" : "neutral"} />
        <StatCard
          label="Abweichung zum Soll"
          value={formatEuro(totals.diffCents)}
          icon={totals.diffCents < 0 ? AlertTriangle : CheckCircle2}
          tone={totals.diffCents < 0 ? "danger" : "neutral"}
          hint="nur gezählte Artikel"
        />
      </div>

      {!closed && <StocktakeLinkCard stocktakeId={info.id} token={info.countToken} expiresAt={info.countTokenExpiresAt} />}

      {closed && (
        <Notice tone="neutral" icon={Lock} title={`Festgeschrieben${info.closedAt ? ` am ${new Date(info.closedAt).toLocaleDateString("de-DE")}` : ""}${info.closedBy ? ` von ${info.closedBy}` : ""}`}>
          Die gezählten Mengen sind als Bestand übernommen. Diese Liste bleibt unverändert.
        </Notice>
      )}

      <Card flush>
        <CardHeader>
          <CardTitle>{info.title}</CardTitle>
          <CardDescription>
            {cutoff ? "Stichtag" : "Zähltag"} {dateLabel}
            {!closed && " · Eingaben werden sofort gespeichert. Enter springt zum nächsten Feld."}
          </CardDescription>
          <CardAction>
            {closed ? (
              <Button asChild variant="outline" className="max-sm:h-11">
                <a href={`/api/warenwirtschaft/stocktakes/${info.id}/export`} aria-label="Als CSV laden">
                  <Download className="h-4 w-4" />
                  <span>CSV<span className="max-sm:sr-only"> laden</span></span>
                </a>
              </Button>
            ) : (
              <Button type="button" onClick={() => setConfirmClose(true)} disabled={saving > 0} className="max-sm:h-11" aria-label="Inventur festschreiben">
                <Lock className="h-4 w-4" />
                <span>Festschreiben</span>
              </Button>
            )}
          </CardAction>
        </CardHeader>
        <CardContent className="px-0 sm:px-0">
          <div className="flex flex-col gap-2 px-4 pb-3 sm:flex-row sm:px-[18px]">
            <SearchInput value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ("")} placeholder="Artikel suchen" aria-label="Artikel suchen" className="h-11 sm:h-9" />
            {categories.length > 1 && (
              <NativeSelect value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Kategorie" containerClassName="sm:w-48" className="h-11 sm:h-9">
                <option value="">Alle Kategorien</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </NativeSelect>
            )}
          </div>
          <div className="px-4 pb-4 sm:px-[18px]">
            <Segmented
              aria-label="Ansicht"
              value={view}
              onValueChange={setView}
              options={[
                { value: "all", label: "Alle", count: lines.length },
                { value: "open", label: "Offen", count: open },
                { value: "counted", label: "Gezählt", count: totals.counted },
                { value: "diff", label: "Abweichung" },
              ]}
            />
          </div>
          {error && <div className="px-4 pb-3 sm:px-[18px]"><Notice tone="danger" compact role="alert" title={error} /></div>}

          <div className="border-t border-border">
            <Table edge>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 max-sm:hidden">Bild</TableHead>
                  <TableHead>Artikel</TableHead>
                  <TableHead className="hidden w-20 text-right md:table-cell">Soll</TableHead>
                  <TableHead className="w-24 text-right">Ist</TableHead>
                  <TableHead className="hidden w-20 text-right sm:table-cell">Bruch</TableHead>
                  <TableHead className="hidden w-28 text-right lg:table-cell">Lagerwert</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && <TableEmpty colSpan={6} icon={ClipboardList} title="Keine Artikel in dieser Ansicht" />}
                {filtered.map((l) => {
                  const diff = l.counted != null && l.counted !== l.expected;
                  return (
                    <TableRow key={l.id}>
                      <TableCell className="max-sm:hidden">
                        <ArticleThumb image={l.image} name={l.name} category={l.category} />
                      </TableCell>
                      <TableCell className="max-w-0 w-full whitespace-normal">
                        <p className="font-medium text-foreground [overflow-wrap:anywhere]">{l.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {[l.unit, l.purchasePriceCents != null ? formatEuro(l.purchasePriceCents) : null, l.countedBy ? `gezählt von ${l.countedBy}` : null].filter(Boolean).join(" · ")}
                          <span className="md:hidden"> · Soll {formatQty(l.expected)}</span>
                        </p>
                        {l.purchasePriceCents == null && !closed && (
                          <Badge variant="warning" className="mr-1 mt-1">EK fehlt</Badge>
                        )}
                        {diff && (
                          <Badge variant={l.counted! < l.expected ? "danger" : "info"} className="mt-1">
                            {l.counted! > l.expected ? "+" : ""}{formatQty(l.counted! - l.expected)}
                          </Badge>
                        )}
                        {/* Handy: Bruch unter dem Namen statt eigener Spalte. */}
                        <div className="mt-1.5 flex items-center gap-2 sm:hidden">
                          <span className="text-xs text-muted-foreground">Bruch</span>
                          {closed ? (
                            <span className="text-xs tabular-nums">{formatQty(l.broken)}</span>
                          ) : (
                            <QtyInput value={l.broken} field="broken" onCommit={(raw) => commit(l, "broken", raw)} label={`Bruch ${l.name}`} invalid={invalid.has(`${l.id}-broken`)} className="w-20" />
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums text-muted-foreground md:table-cell">{formatQty(l.expected)}</TableCell>
                      <TableCell className="text-right">
                        {closed ? (
                          <span className="font-medium tabular-nums">{formatQty(l.counted)}</span>
                        ) : (
                          <QtyInput value={l.counted} field="counted" onCommit={(raw) => commit(l, "counted", raw)} label={`Ist ${l.name}`} invalid={invalid.has(`${l.id}-counted`)} className="w-20" />
                        )}
                      </TableCell>
                      <TableCell className="hidden text-right sm:table-cell">
                        {closed ? (
                          <span className="tabular-nums text-muted-foreground">{formatQty(l.broken)}</span>
                        ) : (
                          <QtyInput value={l.broken} field="broken" onCommit={(raw) => commit(l, "broken", raw)} label={`Bruch ${l.name}`} invalid={invalid.has(`${l.id}-broken`)} className="w-16" />
                        )}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums lg:table-cell">
                        {l.counted == null ? "–" : formatEuro(valueCents(l.counted, l.purchasePriceCents))}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {byCategory.length > 1 && (
        <Card flush>
          <CardHeader>
            <CardTitle>Zusammenfassung</CardTitle>
            <CardDescription>Bewertung netto je Kategorie</CardDescription>
          </CardHeader>
          <CardContent className="px-0 sm:px-0">
            <Table edge>
              <TableHeader>
                <TableRow>
                  <TableHead>Kategorie</TableHead>
                  <TableHead className="w-32 text-right">Lagerwert</TableHead>
                  <TableHead className="hidden w-28 text-right sm:table-cell">Bruch</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byCategory.map((c) => (
                  <TableRow key={c.category}>
                    <TableCell>{c.category}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatEuro(c.totals.valueCents)}</TableCell>
                    <TableCell className="hidden text-right tabular-nums text-muted-foreground sm:table-cell">{formatEuro(c.totals.brokenCents)}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell className="font-semibold">Gesamt</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{formatEuro(totals.valueCents)}</TableCell>
                  <TableCell className="hidden text-right font-semibold tabular-nums sm:table-cell">{formatEuro(totals.brokenCents)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {!closed && (
        <div className="flex justify-end">
          <Button type="button" variant="ghost" onClick={() => setConfirmDelete(true)} className="h-11 gap-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive sm:h-9">
            <Trash2 className="h-4 w-4" />
            Inventur verwerfen
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title="Inventur festschreiben?"
        description={
          open > 0
            ? `${open} Artikel sind noch nicht gezählt und behalten ihren bisherigen Bestand. Gezählte Mengen werden als Bestand übernommen; danach ist die Liste nicht mehr änderbar.`
            : "Die gezählten Mengen werden als Bestand übernommen; danach ist die Liste nicht mehr änderbar."
        }
        confirmLabel="Festschreiben"
        destructive={false}
        onConfirm={close}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Inventur verwerfen?"
        description="Alle Eingaben dieser Zählung gehen verloren. Der Artikelbestand bleibt unverändert."
        confirmLabel="Verwerfen"
        onConfirm={remove}
      />
    </div>
  );
}
