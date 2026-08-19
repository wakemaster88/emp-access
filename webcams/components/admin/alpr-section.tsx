"use client";

import { useEffect, useState } from "react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import {
  AlprConfigSchema,
  type AlprConfig,
  type AlprWhitelistEntry,
} from "@/lib/types";
import {
  CarFront,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  History,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
  XCircle,
} from "lucide-react";

interface AlprSectionProps {
  value: AlprConfig;
  onChange: (next: AlprConfig) => void;
  /** Wird gerufen, wenn der User den Save-Button im Parent-Form klicken sollte. */
  saveHint?: string;
}

interface AlprEvent {
  ts: number;
  plate: string;
  plateNorm: string;
  confidence: number;
  owner: string | null;
  matched: boolean;
  cooldown: boolean;
  doorOpened: boolean;
  doorOpenError: string | null;
  snapshotId: string;
  cameraId?: string;
  cameraName?: string;
}

interface AlprStatus {
  enabled: boolean;
  lastSeenPlate: string;
  lastSeenAt: number;
  lastTickAt: number;
  lastError: string | null;
  fps: number;
  cooldowns: Record<string, number>;
  sources?: Array<{ id: string; name: string }>;
}

const WEEKDAY_LABELS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

function emptyEntry(): AlprWhitelistEntry {
  return {
    plate: "",
    owner: "",
    enabled: true,
    weekdays: [],
    notes: "",
  };
}

export function AlprSection({ value, onChange }: AlprSectionProps) {
  const [status, setStatus] = useState<AlprStatus | null>(null);
  const [events, setEvents] = useState<AlprEvent[]>([]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    snapshotId: string;
    fetchedAt: number;
    detected: Array<{
      plate: string;
      confidence: number;
      matched: boolean;
      owner: string | null;
    }>;
  } | null>(null);
  /** Tickt jede Sekunde, damit „vor Xs"-Anzeigen frisch bleiben — und
   *  hält uns aus dem `react-hooks/purity`-Lint raus, weil `Date.now()`
   *  nicht direkt im Render aufgerufen wird. */
  const [now, setNow] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    // Initialer Wert auf nächsten Tick, nicht synchron im Effekt-Body
    const start = setTimeout(() => setNow(Date.now()), 0);
    return () => {
      clearInterval(id);
      clearTimeout(start);
    };
  }, []);
  const { toast } = useToast();

  // Status + Events alle 3 s pollen, solange ALPR aktiv ist.
  useEffect(() => {
    let stopped = false;
    async function tick() {
      try {
        const [s, e] = await Promise.all([
          fetch("/api/doorbird/alpr/status", { cache: "no-store" }).then((r) =>
            r.ok ? r.json() : null,
          ),
          fetch("/api/doorbird/alpr/events?limit=50", { cache: "no-store" }).then(
            (r) => (r.ok ? r.json() : { events: [] }),
          ),
        ]);
        if (stopped) return;
        setStatus(s);
        setEvents((e?.events ?? []) as AlprEvent[]);
      } catch {
        if (!stopped) setStatus(null);
      }
    }
    void tick();
    const id = setInterval(tick, 3000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, []);

  function update<K extends keyof AlprConfig>(key: K, val: AlprConfig[K]) {
    onChange({ ...value, [key]: val });
  }

  function updateEntry(idx: number, patch: Partial<AlprWhitelistEntry>) {
    const next = value.whitelist.map((e, i) => (i === idx ? { ...e, ...patch } : e));
    update("whitelist", next);
  }

  function removeEntry(idx: number) {
    update(
      "whitelist",
      value.whitelist.filter((_, i) => i !== idx),
    );
  }

  function addEntry() {
    const parsed = AlprConfigSchema.shape.whitelist.safeParse([
      ...value.whitelist,
      emptyEntry(),
    ]);
    if (parsed.success) update("whitelist", parsed.data);
    else update("whitelist", [...value.whitelist, emptyEntry()]);
  }

  async function runTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await fetch("/api/doorbird/alpr/test", { method: "POST" });
      const j = await r.json();
      if (!r.ok) {
        toast(j.error ?? "Test fehlgeschlagen", "error");
        return;
      }
      setTestResult({ ...j, fetchedAt: Date.now() });
      if (j.detected.length === 0) {
        toast("Kein Kennzeichen erkannt", "info");
      } else {
        toast(`${j.detected.length} Kennzeichen erkannt`, "success");
      }
    } finally {
      setTesting(false);
    }
  }

  const lastSeenAgoSec =
    status?.lastSeenAt && status.lastSeenAt > 0 && now > 0
      ? Math.round((now - status.lastSeenAt) / 1000)
      : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <CarFront className="size-5" />
              Kennzeichenerkennung (ALPR)
            </CardTitle>
            <CardDescription>
              Optional Anzeige im Kontrollzentrum. Erkennung und Türöffnung
              laufen am Hub (Fahrzeuge auf emp-access.de). Tracker-Sidecar
              muss nur laufen, wenn hier noch erkannt werden soll.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {status === null && <Badge variant="default">Sidecar offline</Badge>}
            {status && status.enabled && (
              <Badge variant="success">
                <Sparkles className="size-3" /> aktiv · {status.fps.toFixed(1)} fps
              </Badge>
            )}
            {status && !status.enabled && (
              <Badge variant="default">aus</Badge>
            )}
            <Switch
              checked={value.enabled}
              onChange={(v) => update("enabled", v)}
            />
          </div>
        </div>
      </CardHeader>

      {value.enabled && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="Intervall (ms)" hint="500 – 10000, sinnvoll 1000–2000">
              <Input
                type="number"
                min={500}
                max={10000}
                value={value.intervalMs}
                onChange={(e) => update("intervalMs", Number(e.target.value))}
              />
            </Field>
            <Field label="Min. Confidence" hint="0.0 – 1.0; höher = strenger">
              <Input
                type="number"
                step={0.01}
                min={0}
                max={1}
                value={value.minConfidence}
                onChange={(e) =>
                  update("minConfidence", Number(e.target.value))
                }
              />
            </Field>
            <Field label="Bestätigung (Frames)" hint="2-aus-3 = 3 Frames">
              <Input
                type="number"
                min={1}
                max={10}
                value={value.confirmFrames}
                onChange={(e) =>
                  update("confirmFrames", Number(e.target.value))
                }
              />
            </Field>
            <Field label="Cooldown (Sekunden)" hint="pro Schild, gegen Mehrfach-Öffnungen">
              <Input
                type="number"
                min={10}
                max={86_400}
                value={value.cooldownSec}
                onChange={(e) => update("cooldownSec", Number(e.target.value))}
              />
            </Field>
            <Field label="Aufbewahrung (Tage)" hint="0 = unbegrenzt; sonst löschen ältere Snapshots">
              <Input
                type="number"
                min={0}
                max={3650}
                value={value.retentionDays}
                onChange={(e) =>
                  update("retentionDays", Number(e.target.value))
                }
              />
            </Field>
          </div>

          {status?.sources && status.sources.length > 0 && (
            <p className="text-xs text-foreground/60">
              Quellen: {status.sources.map((s) => s.name).join(" · ")}. Weitere
              Kameras unter Kameras → Kennzeichenerkennung.
            </p>
          )}
          <Field label="Bei Treffer Tür öffnen">
            <div className="flex h-10 items-center gap-3">
              <Switch
                checked={value.openDoorbird}
                onChange={(v) => update("openDoorbird", v)}
              />
              <span className="text-xs text-foreground/60">
                Aus lassen: der Hub öffnet lokal. Nur als Notfall-Fallback.
              </span>
            </div>
          </Field>
          {status?.lastError && (
            <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-200 ring-1 ring-amber-500/30">
              Letzter Fehler: {status.lastError}
            </div>
          )}
          {lastSeenAgoSec !== null && status?.lastSeenPlate && (
            <div className="text-xs text-foreground/60">
              Zuletzt gesehen: <span className="font-medium">{status.lastSeenPlate}</span>{" "}
              vor {lastSeenAgoSec}s
            </div>
          )}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-sm font-medium">Whitelist</h4>
              <Button variant="ghost" size="sm" onClick={addEntry}>
                <Plus className="size-3" />
                Schild hinzufügen
              </Button>
            </div>
            {value.whitelist.length === 0 && (
              <p className="rounded-lg border border-dashed border-foreground/20 px-3 py-4 text-center text-xs text-foreground/50">
                Noch keine Schilder. Ohne Whitelist öffnet sich nie etwas automatisch.
              </p>
            )}
            <div className="space-y-2">
              {value.whitelist.map((entry, idx) => (
                <WhitelistRow
                  key={idx}
                  entry={entry}
                  onChange={(patch) => updateEntry(idx, patch)}
                  onRemove={() => removeEntry(idx)}
                />
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">Live-Test</h4>
              <Button
                variant="secondary"
                size="sm"
                onClick={runTest}
                disabled={testing}
              >
                {testing ? "Analysiere…" : "Doorbird-Snapshot jetzt analysieren"}
              </Button>
            </div>
            {testResult && (
              <div className="overflow-hidden rounded-lg ring-1 ring-border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/doorbird/alpr/snapshot/${encodeURIComponent(testResult.snapshotId)}?ts=${testResult.fetchedAt}`}
                  alt="ALPR-Test"
                  className="block w-full"
                />
                <div className="space-y-1 bg-tile-accent p-3">
                  {testResult.detected.length === 0 ? (
                    <p className="text-xs text-foreground/60">
                      Kein Kennzeichen erkannt. Prüf, ob die Doorbird das Auto klar im Bild hat.
                    </p>
                  ) : (
                    testResult.detected.map((d, i) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span className="font-mono">{d.plate}</span>
                        <span className="text-xs text-foreground/60">
                          {(d.confidence * 100).toFixed(0)}% ·{" "}
                          {d.matched ? (
                            <Badge variant="success">in Whitelist · {d.owner}</Badge>
                          ) : (
                            <Badge variant="default">nicht autorisiert</Badge>
                          )}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          <div>
            <h4 className="mb-2 text-sm font-medium">Letzte Erkennungen (live)</h4>
            {events.length === 0 ? (
              <p className="rounded-lg border border-dashed border-foreground/20 px-3 py-4 text-center text-xs text-foreground/50">
                Noch keine Events.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {events.slice(0, 10).map((ev) => (
                  <EventRow key={`${ev.ts}-${ev.snapshotId}`} ev={ev} />
                ))}
              </ul>
            )}
          </div>

          <HistorySection />
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// History-Section: filterbare, paginierte Sicht auf die persistente Historie
// ---------------------------------------------------------------------------

interface HistoryResponse {
  events: AlprEvent[];
  total: number;
  offset: number;
  limit: number;
}

const STATUS_FILTERS: ReadonlyArray<{
  id: "all" | "opened" | "matched" | "unauthorized";
  label: string;
}> = [
  { id: "all", label: "Alle" },
  { id: "opened", label: "Tür geöffnet" },
  { id: "matched", label: "Whitelist-Treffer" },
  { id: "unauthorized", label: "Unbekannte Plates" },
];

const PAGE_SIZE = 20;

function HistorySection() {
  const [items, setItems] = useState<AlprEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]["id"]>(
    "opened",
  );
  const [plate, setPlate] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  // Inkrementiert bei "neu laden", triggert via Effect-Dep einen Re-fetch
  // ohne Filter zurückzusetzen.
  const [refreshTick, setRefreshTick] = useState(0);

  const [lightbox, setLightbox] = useState<AlprEvent | null>(null);

  useEffect(() => {
    let stopped = false;
    async function load() {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(offset));
      if (status !== "all") params.set("status", status);
      if (plate.trim()) params.set("plate", plate.trim());
      if (from) params.set("from_ms", String(new Date(from).getTime()));
      if (to) {
        // bis-Ende-des-Tags ist intuitiver als 00:00 vom selben Tag
        const t = new Date(to);
        t.setHours(23, 59, 59, 999);
        params.set("to_ms", String(t.getTime()));
      }
      try {
        const r = await fetch(
          `/api/doorbird/alpr/history?${params.toString()}`,
          { cache: "no-store" },
        );
        const j = (await r.json()) as HistoryResponse | { error?: string };
        if (stopped) return;
        if (!r.ok) {
          setError("error" in j ? (j.error ?? "Fehler") : "Fehler");
          setItems([]);
          setTotal(0);
        } else {
          const ok = j as HistoryResponse;
          setItems(ok.events);
          setTotal(ok.total);
        }
      } catch (e) {
        if (!stopped) setError((e as Error).message);
      } finally {
        if (!stopped) setLoading(false);
      }
    }
    void load();
    return () => {
      stopped = true;
    };
  }, [status, plate, from, to, offset, refreshTick]);

  // Filter-Änderungen sollen immer auf Seite 1 zurückspringen.
  useEffect(() => {
    setOffset(0);
  }, [status, plate, from, to]);

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-2 text-sm font-medium">
          <History className="size-4" />
          Verlauf
        </h4>
        <span className="text-xs text-foreground/50">
          {total} Einträge insgesamt
        </span>
      </div>

      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto]">
        <div className="flex flex-wrap gap-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setStatus(f.id)}
              className={`rounded-md px-2 py-1.5 text-xs ring-1 ${
                status === f.id
                  ? "bg-focus text-black ring-focus"
                  : "bg-tile ring-border text-foreground/60 hover:text-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <Input
          placeholder="Kennzeichen filtern…"
          value={plate}
          onChange={(e) => setPlate(e.target.value)}
        />
        <Input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <Input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setRefreshTick((t) => t + 1)}
          title="Neu laden"
          disabled={loading}
        >
          <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {error && (
        <div className="mb-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-200 ring-1 ring-amber-500/30">
          {error}
        </div>
      )}

      {!error && items.length === 0 && !loading && (
        <p className="rounded-lg border border-dashed border-foreground/20 px-3 py-4 text-center text-xs text-foreground/50">
          Keine Einträge für diese Filter.
        </p>
      )}

      {items.length > 0 && (
        <ul className="space-y-1.5">
          {items.map((ev) => (
            <HistoryRow
              key={`${ev.ts}-${ev.snapshotId}`}
              ev={ev}
              onOpen={() => setLightbox(ev)}
            />
          ))}
        </ul>
      )}

      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-end gap-2 text-xs text-foreground/60">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
            disabled={offset === 0 || loading}
          >
            <ChevronLeft className="size-3" />
            Zurück
          </Button>
          <span>
            Seite {page} / {totalPages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setOffset((o) => o + PAGE_SIZE)}
            disabled={offset + PAGE_SIZE >= total || loading}
          >
            Weiter
            <ChevronRight className="size-3" />
          </Button>
        </div>
      )}

      {lightbox && (
        <Lightbox ev={lightbox} onClose={() => setLightbox(null)} />
      )}
    </div>
  );
}

function HistoryRow({
  ev,
  onOpen,
}: {
  ev: AlprEvent;
  onOpen: () => void;
}) {
  const d = new Date(ev.ts);
  const date = d.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
  const time = d.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return (
    <li className="flex items-center gap-3 rounded-lg bg-tile-accent p-2 text-sm">
      <button
        type="button"
        onClick={onOpen}
        className="shrink-0"
        title="Snapshot vergrößern"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/doorbird/alpr/snapshot/${encodeURIComponent(ev.snapshotId)}`}
          alt={ev.plate}
          className="h-12 w-20 rounded object-cover ring-1 ring-border transition hover:ring-focus"
        />
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 font-mono text-sm">
          <span className="truncate">{ev.plate}</span>
          <span className="text-xs text-foreground/40">
            {(ev.confidence * 100).toFixed(0)}%
          </span>
        </div>
        <div className="text-xs text-foreground/60">
          {date} · {time}
          {ev.owner ? ` · ${ev.owner}` : ""}
        </div>
      </div>
      <div>
        {ev.doorOpened ? (
          <Badge variant="success">
            <CheckCircle2 className="size-3" />
            geöffnet
          </Badge>
        ) : ev.cooldown ? (
          <Badge variant="default">
            <Clock className="size-3" />
            Cooldown
          </Badge>
        ) : ev.matched ? (
          <Badge variant="warn">
            <XCircle className="size-3" />
            Match, nicht geöffnet
          </Badge>
        ) : (
          <Badge variant="default">
            <XCircle className="size-3" />
            unbekannt
          </Badge>
        )}
      </div>
    </li>
  );
}

function Lightbox({
  ev,
  onClose,
}: {
  ev: AlprEvent;
  onClose: () => void;
}) {
  // ESC zum Schließen — wir hängen das nur einmal pro Lightbox-Lifecycle ein.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const ts = new Date(ev.ts).toLocaleString("de-DE");
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div
        className="relative max-h-[90vh] max-w-5xl overflow-hidden rounded-xl bg-tile-accent ring-1 ring-border"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="absolute right-2 top-2 rounded-full bg-black/60 p-2 text-white hover:bg-black/80"
          onClick={onClose}
          title="Schließen (ESC)"
        >
          <X className="size-4" />
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/doorbird/alpr/snapshot/${encodeURIComponent(ev.snapshotId)}`}
          alt={ev.plate}
          className="block max-h-[80vh] w-auto"
        />
        <div className="space-y-1 p-3 text-sm">
          <div className="flex items-center gap-2 font-mono">
            <span className="text-base">{ev.plate}</span>
            <span className="text-xs text-foreground/50">
              {(ev.confidence * 100).toFixed(0)}%
            </span>
            {ev.doorOpened && (
              <Badge variant="success">
                <CheckCircle2 className="size-3" />
                geöffnet
              </Badge>
            )}
            {!ev.doorOpened && ev.cooldown && (
              <Badge variant="default">
                <Clock className="size-3" />
                Cooldown
              </Badge>
            )}
            {!ev.doorOpened && ev.matched && !ev.cooldown && (
              <Badge variant="warn">Match, nicht geöffnet</Badge>
            )}
            {!ev.matched && <Badge variant="default">unbekannt</Badge>}
          </div>
          <div className="text-xs text-foreground/60">
            {ts}
            {ev.owner ? ` · ${ev.owner}` : ""}
          </div>
          {ev.doorOpenError && (
            <div className="text-xs text-amber-300">
              Tür-Öffnen fehlgeschlagen: {ev.doorOpenError}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function WhitelistRow({
  entry,
  onChange,
  onRemove,
}: {
  entry: AlprWhitelistEntry;
  onChange: (patch: Partial<AlprWhitelistEntry>) => void;
  onRemove: () => void;
}) {
  const [showSchedule, setShowSchedule] = useState(
    entry.weekdays.length > 0 || !!entry.from || !!entry.to,
  );
  return (
    <div className="rounded-lg bg-tile-accent p-3 ring-1 ring-border">
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
        <Input
          value={entry.plate}
          placeholder="ME-AB 1234"
          onChange={(e) => onChange({ plate: e.target.value })}
          className="font-mono"
        />
        <Input
          value={entry.owner}
          placeholder="Halter / Notiz"
          onChange={(e) => onChange({ owner: e.target.value })}
        />
        <div className="flex h-10 items-center px-1">
          <Switch
            checked={entry.enabled}
            onChange={(v) => onChange({ enabled: v })}
          />
        </div>
        <Button variant="ghost" size="sm" onClick={onRemove} title="Entfernen">
          <Trash2 className="size-3 text-red-400" />
        </Button>
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs text-foreground/60">
        <button
          type="button"
          onClick={() => setShowSchedule((s) => !s)}
          className="flex items-center gap-1 hover:text-foreground"
        >
          <Clock className="size-3" />
          {showSchedule ? "Zeitfenster ausblenden" : "Zeitfenster…"}
        </button>
        {!showSchedule && entry.weekdays.length > 0 && (
          <span>
            {entry.weekdays.map((w) => WEEKDAY_LABELS[w]).join(",")}
            {entry.from && entry.to && ` ${entry.from}–${entry.to}`}
          </span>
        )}
      </div>
      {showSchedule && (
        <div className="mt-2 grid gap-2 sm:grid-cols-[2fr_1fr_1fr]">
          <div className="flex flex-wrap gap-1">
            {WEEKDAY_LABELS.map((label, day) => {
              const active = entry.weekdays.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => {
                    const next = active
                      ? entry.weekdays.filter((d) => d !== day)
                      : [...entry.weekdays, day].sort();
                    onChange({ weekdays: next });
                  }}
                  className={`rounded-md px-2 py-1 text-xs ring-1 ${
                    active
                      ? "bg-focus text-black ring-focus"
                      : "bg-tile ring-border text-foreground/60 hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <Input
            type="time"
            value={entry.from ?? ""}
            onChange={(e) => onChange({ from: e.target.value || undefined })}
          />
          <Input
            type="time"
            value={entry.to ?? ""}
            onChange={(e) => onChange({ to: e.target.value || undefined })}
          />
        </div>
      )}
    </div>
  );
}

function EventRow({ ev }: { ev: AlprEvent }) {
  const t = new Date(ev.ts).toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return (
    <li className="flex items-center gap-3 rounded-lg bg-tile-accent p-2 text-sm">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/doorbird/alpr/snapshot/${encodeURIComponent(ev.snapshotId)}`}
        alt={ev.plate}
        className="h-12 w-20 rounded object-cover ring-1 ring-border"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 font-mono text-sm">
          <span className="truncate">{ev.plate}</span>
          <span className="text-xs text-foreground/40">
            {(ev.confidence * 100).toFixed(0)}%
          </span>
        </div>
        <div className="text-xs text-foreground/60">
          {t}
          {ev.cameraName ? ` · ${ev.cameraName}` : ""}
          {ev.owner ? ` · ${ev.owner}` : ""}
        </div>
      </div>
      <div>
        {ev.doorOpened ? (
          <Badge variant="success">
            <CheckCircle2 className="size-3" />
            geöffnet
          </Badge>
        ) : ev.cooldown ? (
          <Badge variant="default">
            <Clock className="size-3" />
            Cooldown
          </Badge>
        ) : ev.matched ? (
          <Badge variant="warn">
            <XCircle className="size-3" />
            Match, nicht geöffnet
          </Badge>
        ) : (
          <Badge variant="default">
            <XCircle className="size-3" />
            unbekannt
          </Badge>
        )}
      </div>
    </li>
  );
}
