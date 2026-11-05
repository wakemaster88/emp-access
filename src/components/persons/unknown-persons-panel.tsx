"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/notice";
import { Segmented } from "@/components/ui/segmented";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Check, Loader2, RefreshCw, ScanFace, Sparkles, Trash2, UserPlus, Users, X,
} from "lucide-react";
import { cn } from "@/lib/utils";

type ListType = "WHITELIST" | "BLACKLIST";

interface Suggestion {
  listedPersonId: number;
  name: string;
  listType: string;
  score: number;
}

interface Group {
  key: string;
  sightingIds: number[];
  count: number;
  firstSeen: string;
  lastSeen: string;
  cameras: string[];
  cohesion: number;
  suggestions: Suggestion[];
}

interface Overview {
  groups: Group[];
  pending: number;
  noFace: number;
  noSnapshot: number;
  total: number;
  analyzeQueued: boolean;
}

interface PersonOption {
  id: number;
  name: string;
  listType: ListType;
}

interface Props {
  people: PersonOption[];
  /** Nach jeder Zuordnung: Seite (Zaehler, Listen) neu laden. */
  onChanged: () => void;
}

const THUMBS = 8;

function fmtRange(a: string, b: string) {
  const opts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" };
  const from = new Date(a).toLocaleString("de-DE", opts);
  const to = new Date(b).toLocaleString("de-DE", opts);
  return from === to ? from : `${from} – ${to}`;
}

export function UnknownPersonsPanel({ people, onChanged }: Props) {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await fetch("/api/person-sightings/unknown", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Waehrend der Hub analysiert, regelmaessig nachladen.
  useEffect(() => {
    if (!data?.analyzeQueued) return;
    const t = setInterval(() => void load(), 8000);
    return () => clearInterval(t);
  }, [data?.analyzeQueued, load]);

  async function analyze() {
    setAnalyzing(true);
    try {
      const res = await fetch("/api/person-sightings/analyze", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      setNotice(
        body.queued
          ? `Hub analysiert ${body.queued} Bilder – Gruppen erscheinen gleich.`
          : "Nichts mehr zu analysieren."
      );
      await load();
    } finally {
      setAnalyzing(false);
    }
  }

  function removeGroupIds(ids: number[]) {
    setData((d) =>
      d
        ? {
            ...d,
            total: d.total - ids.length,
            groups: d.groups
              .map((g) => {
                const rest = g.sightingIds.filter((id) => !ids.includes(id));
                return { ...g, sightingIds: rest, count: rest.length };
              })
              .filter((g) => g.count > 0),
          }
        : d
    );
  }

  async function assign(
    ids: number[],
    target: { listedPersonId: number } | { newPerson: { name: string; listType: ListType } }
  ): Promise<string | null> {
    const res = await fetch("/api/person-sightings/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sightingIds: ids, ...target }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return typeof body.error === "string" ? body.error : "Zuordnen fehlgeschlagen";
    }
    removeGroupIds(ids);
    const samples = (body.samples ?? 0) + (body.enrollTasks ?? 0);
    setNotice(
      `${body.assigned} Sichtung${body.assigned === 1 ? "" : "en"} → ${body.name}` +
        (body.created ? " (neu angelegt)" : "") +
        (samples ? ` · ${samples} Gesichts-Sample${samples === 1 ? "" : "s"} gelernt` : "")
    );
    onChanged();
    // Neue Samples koennen andere Gruppen jetzt besser zuordnen.
    void load();
    return null;
  }

  // Rückfrage kommt aus der Gruppenkarte (AlertDialog, docs/design-regeln.md, Abschnitt 18).
  async function dismiss(ids: number[]): Promise<string | null> {
    const res = await fetch("/api/person-sightings/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sightingIds: ids }),
    });
    if (!res.ok) return "Verwerfen fehlgeschlagen";
    removeGroupIds(ids);
    setNotice(`${ids.length} Sichtung${ids.length === 1 ? "" : "en"} verworfen.`);
    onChanged();
    return null;
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-12 justify-center text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Gesichter werden gruppiert …
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <Card>
        <CardContent className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <div className="text-[13px] text-muted-foreground space-y-0.5">
            <p>
              Ähnliche Gesichter sind gruppiert. Ein Klick ordnet die ganze Gruppe zu oder legt
              eine neue Person an – die Gesichts-Samples werden automatisch gelernt.
              Bilder, die nicht dazugehören, vorher antippen.
            </p>
            {data && (
              <p className="text-xs tabular-nums">
                {data.total} unbekannt · {data.groups.length} Gruppe{data.groups.length === 1 ? "" : "n"}
                {data.pending > 0 && <> · {data.pending} noch nicht analysiert</>}
                {data.noFace > 0 && <> · {data.noFace} ohne erkennbares Gesicht</>}
                {data.noSnapshot > 0 && <> · {data.noSnapshot} ohne Bild</>}
              </p>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            {data && (data.pending > 0 || data.analyzeQueued) && (
              <Button
                size="sm"
                onClick={analyze}
                disabled={analyzing || data.analyzeQueued}
                className="gap-1.5 max-sm:h-11"
              >
                {analyzing || data.analyzeQueued
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <ScanFace className="h-4 w-4" />}
                {data.analyzeQueued ? "Hub analysiert …" : "Bilder analysieren"}
              </Button>
            )}
            <Button
              size="icon-sm"
              variant="outline"
              onClick={() => void load()}
              title="Neu laden"
              aria-label="Neu laden"
              className="max-sm:size-11"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {notice && (
        <Notice
          tone="success"
          compact
          title={notice}
          action={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setNotice("")}
              className="text-muted-foreground max-sm:size-11"
              aria-label="Schließen"
            >
              <X className="h-4 w-4" />
            </Button>
          }
        />
      )}
      {/* Fehler mit Ursache und Handlung; technische Angabe (Statuscode) klein darunter (docs/design-regeln.md, Abschnitt 19). */}
      {error && (
        <Notice
          tone="danger"
          compact
          title="Laden fehlgeschlagen"
          action={
            <Button size="sm" variant="outline" onClick={() => void load()} className="max-sm:h-11">
              Neu laden
            </Button>
          }
        >
          {error !== "Laden fehlgeschlagen" ? error : null}
        </Notice>
      )}

      {data && data.groups.length === 0 ? (
        <Card className="py-0 sm:py-0">
          <EmptyState
            icon={Users}
            title="Keine unbekannten Gesichter offen"
            description={
              data.pending > 0
                ? `${data.pending} ältere Sichtungen sind noch nicht analysiert – „Bilder analysieren“ startet das am Hub.`
                : undefined
            }
          />
        </Card>
      ) : (
        // Eine Spalte mit fester Breite (minmax 0), damit lange Vorschläge die Karten auf dem Handy nicht verbreitern.
        <div className="grid grid-cols-1 gap-4 sm:gap-5">
          {data?.groups.map((g, i) => (
            <GroupCard
              key={g.key}
              index={i}
              group={g}
              people={people}
              onAssign={assign}
              onDismiss={dismiss}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function GroupCard({
  group,
  index,
  people,
  onAssign,
  onDismiss,
}: {
  group: Group;
  index: number;
  people: PersonOption[];
  onAssign: (
    ids: number[],
    target: { listedPersonId: number } | { newPerson: { name: string; listType: ListType } }
  ) => Promise<string | null>;
  onDismiss: (ids: number[]) => Promise<string | null>;
}) {
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [mode, setMode] = useState<"idle" | "new">("idle");
  const [name, setName] = useState("");
  const [listType, setListType] = useState<ListType>("WHITELIST");
  const [personId, setPersonId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirmDismiss, setConfirmDismiss] = useState(false);

  const selected = group.sightingIds.filter((id) => !excluded.has(id));
  const visible = showAll ? group.sightingIds : group.sightingIds.slice(0, THUMBS);

  async function run(fn: () => Promise<string | null>) {
    if (selected.length === 0) {
      setErr("Alle Bilder abgewählt");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const e = await fn();
      if (e) setErr(e);
    } finally {
      setBusy(false);
    }
  }

  function toggle(id: number) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[15px] font-semibold tracking-tight">Unbekannt {index + 1}</h3>
          <Badge variant="neutral">
            {group.count} Sichtung{group.count === 1 ? "" : "en"}
          </Badge>
          {group.count > 1 && group.cohesion < 0.6 && (
            <Badge variant="warning" title="Gesichter in dieser Gruppe unterscheiden sich stärker – bitte prüfen">
              gemischt?
            </Badge>
          )}
          <span className="text-xs text-muted-foreground tabular-nums">
            {group.cameras.join(", ") || "–"} · {fmtRange(group.firstSeen, group.lastSeen)}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          {visible.map((id) => {
            const off = excluded.has(id);
            return (
              <button
                key={id}
                type="button"
                onClick={() => toggle(id)}
                title={off ? "Wieder einbeziehen" : "Gehört nicht dazu – abwählen"}
                aria-label={off ? "Wieder einbeziehen" : "Gehört nicht dazu – abwählen"}
                className={cn(
                  "press relative h-20 w-20 overflow-hidden rounded-xl border bg-muted",
                  off ? "border-dashed border-border opacity-35" : "border-glass-border"
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/person-sightings/${id}/snapshot`}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
                {off && (
                  <span className="absolute inset-0 flex items-center justify-center">
                    <X className="h-6 w-6 text-destructive" />
                  </span>
                )}
              </button>
            );
          })}
          {group.count > THUMBS && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="press h-20 w-20 rounded-xl border border-dashed border-border text-xs text-muted-foreground tabular-nums hover:bg-glass-tile hover:text-foreground"
            >
              {showAll ? "weniger" : `+${group.count - THUMBS} weitere`}
            </button>
          )}
        </div>

        {group.suggestions.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Sparkles className="h-3.5 w-3.5" /> Vorschlag:
            </span>
            {group.suggestions.map((s, i) => (
              // Lange Namen brechen um statt die Karte zu verbreitern (Handy 390 px).
              <Button
                key={s.listedPersonId}
                size="sm"
                variant={i === 0 ? "default" : "outline"}
                disabled={busy}
                className="h-auto min-h-8 max-w-full gap-1.5 whitespace-normal py-1.5 text-left max-sm:min-h-11"
                onClick={() => run(() => onAssign(selected, { listedPersonId: s.listedPersonId }))}
              >
                <Check className="h-3.5 w-3.5" />
                Das ist {s.name}
                <span className="opacity-70 text-xs tabular-nums">{Math.round(s.score * 100)}%</span>
              </Button>
            ))}
          </div>
        )}

        {mode === "new" ? (
          <form
            className="flex flex-col sm:flex-row gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) {
                setErr("Name fehlt");
                return;
              }
              void run(() => onAssign(selected, { newPerson: { name: name.trim(), listType } }));
            }}
          >
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name der neuen Person"
              className="sm:max-w-xs max-sm:h-11"
            />
            {/* Liste als Segmentwahl (Glas-Kapsel mit heller Pille). */}
            <Segmented
              aria-label="Liste"
              value={listType}
              onValueChange={setListType}
              options={(["WHITELIST", "BLACKLIST"] as const).map((t) => ({
                value: t,
                label: t === "WHITELIST" ? "Whitelist" : "Blacklist",
              }))}
              className="shrink-0 self-start sm:self-center"
            />
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={busy} className="gap-1.5 max-sm:h-11">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                Anlegen
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setMode("idle")} className="max-sm:h-11">
                Abbrechen
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            {people.length > 0 && (
              <div className="flex gap-2">
                <Select value={personId} onValueChange={setPersonId}>
                  <SelectTrigger className="w-full sm:w-56 max-sm:data-[size=default]:h-11">
                    <SelectValue placeholder="Bestehende Person …" />
                  </SelectTrigger>
                  <SelectContent>
                    {people.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.name}{p.listType === "BLACKLIST" ? " (Blacklist)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  className="max-sm:h-11"
                  disabled={!personId || busy}
                  onClick={() => run(() => onAssign(selected, { listedPersonId: Number(personId) }))}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Zuordnen"}
                </Button>
              </div>
            )}
            <Button
              size="sm"
              variant={group.suggestions.length > 0 ? "outline" : "default"}
              className="gap-1.5 max-sm:h-11"
              disabled={busy}
              onClick={() => {
                setErr("");
                setMode("new");
              }}
            >
              <UserPlus className="h-4 w-4" /> Neue Person
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5 text-muted-foreground hover:text-destructive sm:ml-auto max-sm:h-11"
              disabled={busy}
              onClick={() => {
                if (selected.length === 0) {
                  setErr("Alle Bilder abgewählt");
                  return;
                }
                setConfirmDismiss(true);
              }}
            >
              <Trash2 className="h-4 w-4" /> Verwerfen
            </Button>
          </div>
        )}

        {/* Verwerfen löscht: Rückfrage mit AlertDialog und destructive-Taste (docs/design-regeln.md, Abschnitt 18). */}
        <AlertDialog open={confirmDismiss} onOpenChange={setConfirmDismiss}>
          <AlertDialogContent aria-describedby={undefined}>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {`${selected.length} Sichtung${selected.length === 1 ? "" : "en"} verwerfen (löschen)?`}
              </AlertDialogTitle>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="max-sm:h-11">Abbrechen</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                className="max-sm:h-11"
                onClick={() => void run(() => onDismiss(selected))}
              >
                Verwerfen
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {excluded.size > 0 && (
          <p className="text-xs text-muted-foreground">
            {excluded.size} Bild{excluded.size === 1 ? "" : "er"} abgewählt – bleib{excluded.size === 1 ? "t" : "en"} unbekannt.
          </p>
        )}
        {err && <Notice tone="danger" compact title={err} />}
      </CardContent>
    </Card>
  );
}
