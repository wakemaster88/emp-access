"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Copy, FileText, Loader2, RefreshCw } from "lucide-react";

type HubLogFile = "hub" | "error" | "improve";

interface HubLogResult {
  file: HubLogFile;
  path: string;
  exists: boolean;
  sizeBytes: number;
  mtime: string | null;
  lines: string[];
  scanned: number;
  truncated: boolean;
  grep: string | null;
  hub: string;
  version: string;
  at: string;
}

interface TaskRow {
  id: number;
  status: string;
  result: HubLogResult | null;
  error: string | null;
}

const FILES: { value: HubLogFile; label: string }[] = [
  { value: "hub", label: "Hub-Log" },
  { value: "error", label: "Fehler-Log" },
  { value: "improve", label: "Diagnose" },
];

const LINE_OPTIONS = [200, 500, 1500];
/** Hub pollt Tasks alle 5 s; nach 60 s ohne Antwort gilt er als nicht erreichbar. */
const POLL_MS = 2_000;
const TIMEOUT_MS = 60_000;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * „Log abrufen“: legt einen HUB_LOG-Task an, wartet auf das Ergebnis und
 * zeigt die Zeilen an. Der Hub liest nur das Dateiende, deshalb kommt die
 * Antwort in wenigen Sekunden – auch bei einem Log von mehreren MB.
 */
export function HubLogButton({ hubName }: { hubName?: string }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<HubLogFile>("hub");
  const [lines, setLines] = useState(LINE_OPTIONS[1]);
  const [grep, setGrep] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<HubLogResult | null>(null);
  const [copied, setCopied] = useState(false);
  const abort = useRef(false);
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!open) abort.current = true;
  }, [open]);

  useEffect(() => {
    // Neueste Zeile sichtbar machen.
    if (result && preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight;
  }, [result]);

  async function fetchLog() {
    abort.current = false;
    setLoading(true);
    setError(null);
    setCopied(false);
    try {
      const created = await fetch("/api/hub/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "HUB_LOG",
          payload: { file, lines, grep: grep.trim() || undefined },
        }),
      });
      if (!created.ok) throw new Error(`Task konnte nicht angelegt werden (HTTP ${created.status})`);
      const task = (await created.json()) as { id: number };

      const started = Date.now();
      while (Date.now() - started < TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (abort.current) return;
        const res = await fetch(`/api/hub/tasks/${task.id}`, { cache: "no-store" });
        if (!res.ok) continue;
        const row = (await res.json()) as TaskRow;
        if (row.status === "DONE" && row.result) {
          setResult(row.result);
          return;
        }
        if (row.status === "FAILED") {
          throw new Error(row.error || "Hub meldet einen Fehler");
        }
      }
      throw new Error(
        "Keine Antwort vom Hub innerhalb von 60 s. Er ist offline oder fährt noch einen Stand ohne Log-Abruf."
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function openDialog() {
    setOpen(true);
    if (!result && !loading) void fetchLog();
  }

  async function copyAll() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={openDialog} className="gap-1.5">
        <FileText className="h-3.5 w-3.5" />
        Log abrufen
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-5xl max-h-[90vh] flex flex-col gap-3">
          <DialogHeader>
            <DialogTitle>Hub-Log{hubName ? ` · ${hubName}` : ""}</DialogTitle>
            <DialogDescription>
              Das Ende der Logdatei, direkt vom Hub geliefert. Der Hub holt den Auftrag beim
              nächsten Poll ab, die Antwort dauert einige Sekunden.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-md border border-border overflow-hidden">
              {FILES.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setFile(f.value)}
                  className={
                    "px-2.5 py-1 text-xs " +
                    (file === f.value
                      ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                      : "bg-transparent text-muted-foreground hover:bg-muted")
                  }
                >
                  {f.label}
                </button>
              ))}
            </div>
            <select
              value={lines}
              onChange={(e) => setLines(Number(e.target.value))}
              className="h-7 rounded-md border border-border bg-transparent px-2 text-xs"
              aria-label="Anzahl Zeilen"
            >
              {LINE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n} Zeilen
                </option>
              ))}
            </select>
            <Input
              value={grep}
              onChange={(e) => setGrep(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !loading) void fetchLog();
              }}
              placeholder="Filter, z. B. ALPR oder Fahrzeug-Burst"
              className="h-7 w-56 text-xs"
            />
            <Button size="sm" variant="secondary" onClick={() => void fetchLog()} disabled={loading} className="gap-1.5">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {loading ? "Warte auf Hub …" : "Neu laden"}
            </Button>
            <Button size="sm" variant="ghost" onClick={copyAll} disabled={!result} className="gap-1.5">
              <Copy className="h-3.5 w-3.5" />
              {copied ? "Kopiert" : "Kopieren"}
            </Button>
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          {result && (
            <p className="text-[11px] text-muted-foreground">
              {result.hub} ({result.version}) · {result.exists ? result.path : "Datei fehlt, Zeilen aus dem Speicher"}
              {result.exists ? ` · ${formatBytes(result.sizeBytes)}` : ""}
              {result.mtime ? ` · zuletzt ${new Date(result.mtime).toLocaleString("de-DE")}` : ""}
              {" · "}
              {result.lines.length} von {result.scanned} Zeilen
              {result.grep ? ` (Filter „${result.grep}“)` : ""}
              {result.truncated ? " · älteres gekürzt" : ""}
            </p>
          )}

          <pre
            ref={preRef}
            className="flex-1 min-h-[40vh] max-h-[60vh] overflow-auto rounded-md border border-border bg-slate-950 text-slate-100 p-3 text-[11px] leading-relaxed whitespace-pre-wrap break-words font-mono"
          >
            {result
              ? result.lines.length > 0
                ? result.lines.join("\n")
                : "Keine Zeilen (Filter zu eng oder Log leer)."
              : loading
                ? "Warte auf den Hub …"
                : ""}
          </pre>
        </DialogContent>
      </Dialog>
    </>
  );
}
