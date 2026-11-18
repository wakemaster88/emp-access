"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { FileSpreadsheet, Loader2 } from "lucide-react";

interface ImportSummary {
  articlesCreated: number;
  articlesSkipped: number;
  stocktake: { id: number; date: string } | null;
  assetsCreated: number;
  assetsSkipped: number;
  counts: number;
}

function summary(r: ImportSummary): string {
  const parts: string[] = [];
  if (r.articlesCreated || r.articlesSkipped) parts.push(`${r.articlesCreated} Artikel angelegt${r.articlesSkipped ? `, ${r.articlesSkipped} schon vorhanden` : ""}`);
  if (r.stocktake) parts.push(`Stichtagsinventur ${new Date(r.stocktake.date).toLocaleDateString("de-DE", { timeZone: "UTC" })} übernommen`);
  if (r.assetsCreated || r.assetsSkipped) parts.push(`${r.assetsCreated} Inventar-Einträge mit ${r.counts} Mengen angelegt${r.assetsSkipped ? `, ${r.assetsSkipped} schon vorhanden` : ""}`);
  return parts.join(". ") + ".";
}

/**
 * Excel-Import (Inventurliste oder Inventarliste). Bereits vorhandene
 * Einträge bleiben unverändert, die Datei darf also mehrfach geladen werden.
 */
export function WawiImportButton({ hint }: { hint: string }) {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/warenwirtschaft/import", { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Import fehlgeschlagen");
      setResult(summary(data as ImportSummary));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <input ref={ref} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={onFile} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button type="button" variant="outline" onClick={() => ref.current?.click()} disabled={busy} className="h-11 gap-1.5 sm:h-9">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
          {busy ? "Importiere …" : "Excel importieren"}
        </Button>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </div>
      {result && <Notice tone="success" compact title={result} />}
      {error && <Notice tone="danger" compact role="alert" title={error} />}
    </div>
  );
}
