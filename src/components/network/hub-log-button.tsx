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
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { Segmented } from "@/components/ui/segmented";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Copy, FileText, Loader2, RefreshCw } from "lucide-react";

type HubLogFile = "hub" | "error" | "improve";
type HubLogMode = "tail" | "at" | "before" | "after";

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
  mode: HubLogMode;
  windowStart: number;
  windowEnd: number;
  hasOlder: boolean;
  hasNewer: boolean;
  firstTs: string | null;
  lastTs: string | null;
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

/** Position im Log: Dateiende, ab Zeitpunkt oder Blättern um eine Byte-Position. */
type Position = { at?: string; before?: number; after?: number };

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

function formatTs(iso: string | null): string {
  if (!iso) return "–";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("de-DE");
}

/** Wert für <input type="datetime-local"> in lokaler Zeit. */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * „Log abrufen“: legt einen HUB_LOG-Task an, wartet auf das Ergebnis und
 * zeigt die Zeilen an. Der Hub liest nur ein Fenster von 1 MB – am Ende, ab
 * einem Zeitpunkt (Binärsuche über die Zeitstempel) oder blätternd. Deshalb
 * kommt die Antwort in wenigen Sekunden, auch bei einem Log von 100 MB.
 */
export function HubLogButton({ hubName }: { hubName?: string }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<HubLogFile>("hub");
  const [lines, setLines] = useState(LINE_OPTIONS[1]);
  const [grep, setGrep] = useState("");
  const [atInput, setAtInput] = useState(() => toLocalInput(new Date(Date.now() - 3_600_000)));
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
    // Rückwärts gelesen: neueste Zeile sichtbar machen; vorwärts: oben anfangen.
    if (!result || !preRef.current) return;
    const forward = result.mode === "at" || result.mode === "after";
    preRef.current.scrollTop = forward ? 0 : preRef.current.scrollHeight;
  }, [result]);

  async function fetchLog(position: Position = {}) {
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
          payload: { file, lines, grep: grep.trim() || undefined, ...position },
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

  function fetchAt() {
    const d = new Date(atInput);
    if (Number.isNaN(d.getTime())) {
      setError("Zeitpunkt ungültig");
      return;
    }
    void fetchLog({ at: d.toISOString() });
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

  const modeLabel: Record<HubLogMode, string> = {
    tail: "Dateiende",
    at: "ab Zeitpunkt",
    before: "älterer Abschnitt",
    after: "neuerer Abschnitt",
  };

  return (
    <>
      {/* Auf dem Handy nur „Log“, damit die Hub-Tasten in einer Zeile stehen
          (docs/design-regeln.md, Abschnitt 13); der volle Text bleibt als Name der Taste. */}
      <Button variant="outline" size="sm" onClick={openDialog} className="gap-1.5 max-sm:h-11" aria-label="Log abrufen">
        <FileText className="h-3.5 w-3.5" />
        <span>Log<span className="max-sm:hidden"> abrufen</span></span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-5xl flex flex-col gap-3">
          <DialogHeader>
            <DialogTitle>Hub-Log{hubName ? ` · ${hubName}` : ""}</DialogTitle>
            <DialogDescription>
              Direkt vom Hub geliefert: das Dateiende, ein Abschnitt ab Zeitpunkt oder blätternd.
              Der Hub holt den Auftrag beim nächsten Poll ab, die Antwort dauert einige Sekunden.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center gap-2">
            {/* Datei-Wahl als Segmentwahl, Zeilenzahl als Auswahlfeld (docs/design-regeln.md, Abschnitt 14). */}
            <Segmented
              aria-label="Log-Datei"
              value={file}
              onValueChange={setFile}
              options={FILES}
            />
            <Select value={String(lines)} onValueChange={(v) => setLines(Number(v))}>
              <SelectTrigger size="sm" aria-label="Anzahl Zeilen">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LINE_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n} Zeilen
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={grep}
              onChange={(e) => setGrep(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !loading) void fetchLog();
              }}
              placeholder="Filter, z. B. ALPR oder Fahrzeug-Burst"
              className="h-8 w-full sm:w-52"
            />
            <Button size="sm" variant="secondary" onClick={() => void fetchLog()} disabled={loading} className="gap-1.5">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {loading ? "Warte auf Hub …" : "Dateiende"}
            </Button>
            <Button size="sm" variant="ghost" onClick={copyAll} disabled={!result} className="gap-1.5">
              <Copy className="h-3.5 w-3.5" />
              {copied ? "Kopiert" : "Kopieren"}
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Label className="text-[13px] font-normal text-muted-foreground" htmlFor="hub-log-at">
              Ab Zeitpunkt
            </Label>
            <Input
              id="hub-log-at"
              type="datetime-local"
              value={atInput}
              onChange={(e) => setAtInput(e.target.value)}
              className="h-8 w-full sm:w-52"
              disabled={file !== "hub"}
            />
            <Button size="sm" variant="secondary" onClick={fetchAt} disabled={loading || file !== "hub"}>
              Ab hier lesen
            </Button>
            <span className="mx-1 h-4 w-px bg-border" aria-hidden />
            <Button
              size="sm"
              variant="outline"
              onClick={() => result && void fetchLog({ before: result.windowStart })}
              disabled={loading || !result?.hasOlder}
              className="gap-1"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Älter
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => result && void fetchLog({ after: result.windowEnd })}
              disabled={loading || !result?.hasNewer}
              className="gap-1"
            >
              Neuer
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>

          {error && <Notice tone="danger" compact title={error} />}

          {result && (
            <p className="text-[11px] text-muted-foreground tabular-nums">
              {result.hub} ({result.version}) · {result.exists ? result.path : "Datei fehlt, Zeilen aus dem Speicher"}
              {result.exists ? ` · ${formatBytes(result.sizeBytes)}` : ""}
              {result.mtime ? ` · zuletzt ${formatTs(result.mtime)}` : ""}
              {" · "}
              {modeLabel[result.mode]}
              {result.exists
                ? ` (Bytes ${formatBytes(result.windowStart)} bis ${formatBytes(result.windowEnd)})`
                : ""}
              {" · "}
              {result.lines.length} von {result.scanned} Zeilen
              {result.grep ? ` (Filter „${result.grep}“)` : ""}
              {result.truncated ? " · im Fenster gekürzt" : ""}
              {result.firstTs ? ` · ${formatTs(result.firstTs)} bis ${formatTs(result.lastTs)}` : ""}
            </p>
          )}

          <pre
            ref={preRef}
            className="glass-tile flex-1 min-h-[40vh] max-h-[60vh] overflow-auto scrollbar-thin p-3 text-[11px] leading-relaxed whitespace-pre-wrap break-words font-mono text-foreground"
          >
            {result
              ? result.lines.length > 0
                ? result.lines.join("\n")
                : "Keine Zeilen (Filter zu eng, Abschnitt leer oder Zeitpunkt hinter dem Dateiende)."
              : loading
                ? "Warte auf den Hub …"
                : ""}
          </pre>
        </DialogContent>
      </Dialog>
    </>
  );
}
