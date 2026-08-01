"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, ArrowRight, TriangleAlert, ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Gegenüberstellung von Scans und gezählten Durchgängen.
 *
 * Der Zähler auf dem Dashboard sagt nur „drei ungedeckt". Hier sieht man,
 * welcher Durchgang zu welchem Scan gehört und wie viele Sekunden dazwischen
 * lagen — damit lässt sich beurteilen, ob eine Differenz echte Mitläufer
 * sind oder ob die Kamera danebenlag.
 */

type Entry =
  | {
      kind: "paired";
      ts: number;
      scanTs: number;
      device: string;
      ticket: string | null;
      lagSec: number;
    }
  | { kind: "crossing-only"; ts: number; snap: boolean }
  | { kind: "scan-only"; ts: number; device: string; ticket: string | null }
  | {
      kind: "denied";
      ts: number;
      device: string;
      ticket: string | null;
      result: "DENIED" | "PROTECTED";
    };

interface Timeline {
  camId: string;
  camName: string;
  minutes: number;
  from: number;
  truncated: boolean;
  limitedBy: "crossings" | "scans" | null;
  summary: {
    paired: number;
    crossingOnly: number;
    scanOnly: number;
    denied: number;
    matchRate: number | null;
  };
  entries: Entry[];
  error?: string;
}

const ZEITRAEUME = [15, 30, 60, 180, 480];

function uhr(ts: number) {
  return new Date(ts).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function DrehkreuzPage() {
  const [minutes, setMinutes] = useState(60);
  const [data, setData] = useState<Timeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [lightbox, setLightbox] = useState<{ url: string; ts: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/tailgate/timeline?minutes=${minutes}`, {
        cache: "no-store",
      });
      setData(await r.json());
    } catch {
      setData(null);
    }
    setLoading(false);
  }, [minutes]);

  // Der Spinner läuft nur beim Knopfdruck — die Liste aktualisiert sich alle
  // 15 Sekunden von selbst und soll dabei nicht blinken.
  const refresh = useCallback(() => {
    setLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 15000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Drehkreuz-Kontrolle"
        description="Jeder gezählte Durchgang neben dem Scan, zu dem er gehört. So lässt sich prüfen, ob die Zählung stimmt, bevor man ihren Alarmen vertraut."
        actions={
          <div className="flex items-center gap-2">
            <Select
              value={String(minutes)}
              onChange={(e) => setMinutes(Number(e.target.value))}
            >
              {ZEITRAEUME.map((m) => (
                <option key={m} value={m}>
                  {m < 60
                    ? `${m} Minuten`
                    : m === 60
                      ? "1 Stunde"
                      : `${m / 60} Stunden`}
                </option>
              ))}
            </Select>
            <Button variant="secondary" onClick={refresh}>
              <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
              Aktualisieren
            </Button>
          </div>
        }
      />

      {data?.error && (
        <Card className="mb-4 border-amber-500/40 bg-amber-500/5 p-4 text-sm">
          <span className="flex items-center gap-2 text-amber-200">
            <TriangleAlert className="size-4" />
            {data.error}
          </span>
        </Card>
      )}

      {data && !data.error && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kennzahl
              label="mit Scan"
              wert={data.summary.paired}
              ton="gut"
              hinweis="Durchgang und Berechtigung passen zusammen"
            />
            <Kennzahl
              label="ohne Scan"
              wert={data.summary.crossingOnly}
              ton={data.summary.crossingOnly > 0 ? "warn" : "neutral"}
              hinweis="Gezählt, aber keine Berechtigung gefunden"
            />
            <Kennzahl
              label="ohne Durchgang"
              wert={data.summary.scanOnly}
              ton="neutral"
              hinweis="Gescannt, aber niemand über der Linie — meist eine Fehlzählung"
            />
            <Kennzahl
              label="Trefferquote"
              wert={data.summary.matchRate === null ? "—" : `${data.summary.matchRate} %`}
              ton={
                data.summary.matchRate === null
                  ? "neutral"
                  : data.summary.matchRate >= 85
                    ? "gut"
                    : "warn"
              }
              hinweis="Anteil der Durchgänge mit passendem Scan"
            />
          </div>

          {data.truncated && (
            <p className="mb-4 text-xs text-foreground/50">
              Ausgewertet ab{" "}
              {new Date(data.from).toLocaleString("de-DE", {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
              {data.limitedBy === "crossings"
                ? " — davor liegen keine gezählten Durchgänge vor, etwa weil der Zähler zurückgesetzt wurde oder die Kamera stand."
                : " — so weit reicht das Scan-Archiv zurück. Es füllt sich weiter, solange der Server läuft."}
            </p>
          )}

          <Card className="divide-y divide-border p-0">
            {data.entries.length === 0 ? (
              <p className="p-6 text-center text-sm text-foreground/55">
                In diesem Zeitraum ist nichts passiert.
              </p>
            ) : (
              data.entries.map((e, i) => (
                <Zeile
                  key={`${e.kind}-${e.ts}-${i}`}
                  e={e}
                  camId={data.camId}
                  onOpen={setLightbox}
                />
              ))
            )}
          </Card>
        </>
      )}

      {!data && !loading && (
        <p className="text-sm text-foreground/55">Keine Daten abrufbar.</p>
      )}

      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/80 p-8"
          onClick={() => setLightbox(null)}
        >
          <figure className="max-h-full max-w-4xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightbox.url}
              alt="Durchgang ohne Scan"
              className="max-h-[80vh] rounded-lg"
            />
            <figcaption className="mt-2 text-center text-sm text-white/70">
              Durchgang ohne Scan ·{" "}
              {new Date(lightbox.ts).toLocaleString("de-DE")}
            </figcaption>
          </figure>
        </div>
      )}
    </div>
  );
}

function Kennzahl({
  label,
  wert,
  ton,
  hinweis,
}: {
  label: string;
  wert: number | string;
  ton: "gut" | "warn" | "neutral";
  hinweis: string;
}) {
  return (
    <div title={hinweis}>
      <Card className="p-3">
        <p
          className={cn(
            "text-2xl font-semibold tabular-nums",
            ton === "gut" && "text-emerald-300",
            ton === "warn" && "text-amber-300",
          )}
        >
          {wert}
        </p>
        <p className="text-xs uppercase tracking-wide text-foreground/55">{label}</p>
      </Card>
    </div>
  );
}

function Zeile({
  e,
  camId,
  onOpen,
}: {
  e: Entry;
  camId: string;
  onOpen: (v: { url: string; ts: number }) => void;
}) {
  if (e.kind === "paired") {
    return (
      <div className="flex items-center gap-3 px-4 py-2 text-sm">
        <span className="w-20 shrink-0 font-mono tabular-nums text-foreground/60">
          {uhr(e.scanTs)}
        </span>
        <span className="min-w-0 flex-1 truncate">
          {e.ticket ?? "—"}
          <span className="text-foreground/50"> · {e.device}</span>
        </span>
        <ArrowRight className="size-3.5 shrink-0 text-foreground/40" />
        <span className="w-20 shrink-0 font-mono tabular-nums text-emerald-300">
          {uhr(e.ts)}
        </span>
        <span className="w-16 shrink-0 text-right text-xs text-foreground/50">
          +{e.lagSec.toFixed(1)} s
        </span>
      </div>
    );
  }

  if (e.kind === "crossing-only") {
    const url = `/api/tailgate/snapshot?camId=${encodeURIComponent(camId)}&ts=${e.ts}`;
    return (
      <div className="flex items-center gap-3 bg-amber-500/5 px-4 py-2 text-sm">
        {e.snap ? (
          <button
            type="button"
            onClick={() => onOpen({ url, ts: e.ts })}
            className="w-20 shrink-0 cursor-zoom-in overflow-hidden rounded border border-amber-500/30 transition-opacity hover:opacity-80"
            title="Bild aus dem Moment des Durchgangs"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="" className="h-11 w-full object-cover" />
          </button>
        ) : (
          <span className="w-20 shrink-0 font-mono tabular-nums text-foreground/30">
            —
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-amber-200">
          Durchgang ohne Scan
        </span>
        <ArrowRight className="size-3.5 shrink-0 text-foreground/40" />
        <span className="w-20 shrink-0 font-mono tabular-nums text-amber-200">
          {uhr(e.ts)}
        </span>
        <span className="w-16 shrink-0" />
      </div>
    );
  }

  if (e.kind === "scan-only") {
    return (
      <div className="flex items-center gap-3 px-4 py-2 text-sm">
        <span className="w-20 shrink-0 font-mono tabular-nums text-foreground/60">
          {uhr(e.ts)}
        </span>
        <span className="min-w-0 flex-1 truncate">
          {e.ticket ?? "—"}
          <span className="text-foreground/50"> · {e.device}</span>
        </span>
        <ArrowRight className="size-3.5 shrink-0 text-foreground/25" />
        <span className="w-20 shrink-0 text-xs text-foreground/45">
          nicht gezählt
        </span>
        <span className="w-16 shrink-0" />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 bg-rose-500/5 px-4 py-2 text-sm">
      <span className="w-20 shrink-0 font-mono tabular-nums text-rose-200">
        {uhr(e.ts)}
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-rose-200">
        <ShieldAlert className="size-3.5 shrink-0" />
        {e.result === "DENIED" ? "Abgelehnt" : "Gesperrt"}
        <span className="text-rose-200/60">· {e.device}</span>
      </span>
      <span className="w-20 shrink-0" />
      <span className="w-16 shrink-0" />
    </div>
  );
}
