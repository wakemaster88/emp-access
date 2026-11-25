"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ClipboardList,
  Plus,
  ShieldAlert,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { NativeSelect } from "@/components/ui/native-select";
import { SearchInput } from "@/components/ui/search-input";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { ArticleThumb } from "./article-visual";
import { QtyInput, type Field } from "./qty-input";
import { AddArticleDialog } from "./public-add-article";
import { LoadingCard, NameGate, PhotoButton, Shell, StateCard, readCounterName, uploadPhoto } from "./public-count-shared";
import { parseGermanNumber } from "@/lib/warenwirtschaft";

export interface Line {
  id: number;
  name: string;
  sku: string | null;
  category: string;
  unit: string | null;
  counted: number | null;
  broken: number | null;
  countedBy: string | null;
  /** Bild in der Liste ohne `fotos=url` bzw. gerade vom Handy hochgeladen. */
  image?: string | null;
  /** Liste mit `fotos=url`: ob ein Foto da ist und wo es liegt. */
  hasImage?: boolean;
  imageUrl?: string | null;
}

interface Payload {
  title: string;
  kind: "ROLLING" | "CUTOFF";
  date: string;
  accountName: string;
  expiresAt: string | null;
  lines: Line[];
}

type View = "open" | "counted" | "all";

const REFRESH_MS = 30_000;

/**
 * Zählseite fürs Handy (`/zaehlen/<token>`), ohne Login. Mitarbeiter geben
 * einmal ihren Namen ein und tragen dann Ist- und Bruchmengen ein; jede
 * Eingabe wird sofort gespeichert. Mehrere Personen können gleichzeitig
 * zählen, die Liste gleicht sich alle 30 Sekunden ab.
 */
export function PublicCountClient({ token }: { token: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [gone, setGone] = useState<string | null>(null);
  const [name, setName] = useState(readCounterName);
  const [view, setView] = useState<View>("open");
  const [showBroken, setShowBroken] = useState(false);
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [saving, setSaving] = useState(0);
  const [error, setError] = useState("");
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);
  const loaded = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/zaehlen/${token}?fotos=url`, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setGone(body?.error ?? "Dieser Link ist nicht mehr gültig.");
        return;
      }
      // Während gespeichert wird, nicht mit dem älteren Serverstand überschreiben.
      if (pending.current === 0) {
        setData(body as Payload);
        // Stichtagsinventur: Bruch gleich mit anbieten.
        if (!loaded.current) setShowBroken((body as Payload).kind === "CUTOFF");
        loaded.current = true;
      }
    } catch {
      /* offline: beim nächsten Abgleich wieder versuchen */
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
    const t = setInterval(() => {
      if (
        document.visibilityState === "visible" &&
        !document.activeElement?.matches("input[data-count-input]")
      )
        void load();
    }, REFRESH_MS);
    const onVisible = () =>
      document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const lines = useMemo(() => data?.lines ?? [], [data]);
  const categories = useMemo(
    () => [...new Set(lines.map((l) => l.category))],
    [lines],
  );
  const countedCount = lines.filter((l) => l.counted != null).length;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return lines.filter((l) => {
      if (category && l.category !== category) return false;
      if (
        needle &&
        !l.name.toLowerCase().includes(needle) &&
        !l.sku?.toLowerCase().includes(needle)
      )
        return false;
      if (view === "open") return l.counted == null;
      if (view === "counted") return l.counted != null;
      return true;
    });
  }, [lines, q, category, view]);

  const commit = useCallback(
    (line: Line, field: Field, raw: string) => {
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
      setData(
        (d) =>
          d && {
            ...d,
            lines: d.lines.map((l) =>
              l.id === line.id ? { ...l, [field]: parsed, countedBy: name } : l,
            ),
          },
      );
      pending.current += 1;
      setSaving((n) => n + 1);
      setError("");
      queue.current = queue.current.then(async () => {
        try {
          const res = await fetch(`/api/zaehlen/${token}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name,
              lines: [{ id: line.id, [field]: parsed }],
            }),
          });
          if (res.status === 404 || res.status === 410) {
            const body = await res.json().catch(() => null);
            setGone(body?.error ?? "Dieser Link ist nicht mehr gültig.");
            return;
          }
          if (!res.ok) throw new Error();
        } catch {
          setError(
            "Speichern fehlgeschlagen. Prüfe die Verbindung und gib den Wert erneut ein.",
          );
        } finally {
          pending.current -= 1;
          setSaving((n) => n - 1);
        }
      });
    },
    [name, token],
  );

  async function savePhoto(line: Line, image: string) {
    const err = await uploadPhoto(`/api/zaehlen/${token}/image`, { name, id: line.id, image });
    if (err) {
      setError(err);
      return;
    }
    setData((d) => d && { ...d, lines: d.lines.map((l) => (l.id === line.id ? { ...l, image } : l)) });
  }

  if (gone) {
    return (
      <Shell accountName={data?.accountName}>
        <StateCard
          icon={ShieldAlert}
          tone="neutral"
          title="Zählen nicht möglich"
          text={gone}
        />
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

  const dateLabel = new Date(data.date).toLocaleDateString("de-DE", {
    timeZone: "UTC",
  });

  if (!name) {
    return (
      <Shell accountName={data.accountName}>
        <NameGate
          icon={ClipboardList}
          title={data.title}
          subtitle={`${data.kind === "CUTOFF" ? "Stichtag" : "Zähltag"} ${dateLabel} · ${data.lines.length} Artikel`}
          initial=""
          onName={setName}
        />
      </Shell>
    );
  }

  const done = countedCount === data.lines.length;

  return (
    <Shell accountName={data.accountName}>
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-foreground [overflow-wrap:anywhere]">
              {data.title}
            </h1>
            <p className="text-sm text-muted-foreground tabular-nums">
              {countedCount} von {data.lines.length} gezählt
              {saving > 0 && " · speichert …"}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-11 shrink-0 gap-1.5 text-muted-foreground"
            onClick={() => setName("")}
            aria-label={`Name ändern, angemeldet als ${name}`}
          >
            <UserRound className="h-4 w-4" />
            <span className="max-w-24 truncate">{name}</span>
          </Button>
        </div>

        <div
          className="h-1.5 overflow-hidden rounded-full bg-muted"
          aria-hidden
        >
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{
              width: `${data.lines.length ? (countedCount / data.lines.length) * 100 : 0}%`,
            }}
          />
        </div>

        <div className="sticky top-0 z-10 -mx-4 space-y-2 border-b border-border bg-background px-4 pb-2 pt-2 shadow-[0_6px_12px_-10px_oklch(0_0_0/25%)]">
          <div className="flex gap-2">
            <SearchInput
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onClear={() => setQ("")}
              placeholder="Suchen"
              aria-label="Artikel suchen"
              className="h-11"
              containerClassName="min-w-0 flex-1"
            />
            {categories.length > 1 && (
              <NativeSelect
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                aria-label="Kategorie"
                className="h-11"
                containerClassName="w-32 shrink-0"
              >
                <option value="">Alle</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </NativeSelect>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Segmented
              aria-label="Ansicht"
              size="sm"
              stretch
              className="min-w-0 flex-1"
              value={view}
              onValueChange={setView}
              options={[
                {
                  value: "open",
                  label: "Offen",
                  count: data.lines.length - countedCount,
                },
                { value: "counted", label: "Gezählt", count: countedCount },
                { value: "all", label: "Alle" },
              ]}
            />
            <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
              Bruch
              <Switch
                size="sm"
                checked={showBroken}
                onCheckedChange={setShowBroken}
                aria-label="Bruch erfassen"
              />
            </label>
          </div>
        </div>

        {error && <Notice tone="danger" compact role="alert" title={error} />}

        {filtered.length === 0 ? (
          done && view === "open" && !q && !category ? (
            <StateCard
              icon={CheckCircle2}
              tone="success"
              title="Alles gezählt"
              text="Danke! Alle Artikel haben eine Menge. Das Büro schreibt die Inventur fest."
            />
          ) : (
            <Card className="items-center gap-3 py-8 text-center text-sm text-muted-foreground sm:py-8">
              {q.trim()
                ? `„${q.trim()}“ ist in dieser Ansicht nicht dabei.`
                : "Keine Artikel in dieser Ansicht"}
              {q.trim() && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-11"
                  onClick={() => setAdding(true)}
                >
                  <Plus className="h-4 w-4" />
                  Als neuen Artikel hinzufügen
                </Button>
              )}
            </Card>
          )
        ) : (
          <Card flush>
            <ul className="divide-y divide-border">
              {filtered.map((l) => (
                <li
                  key={l.id}
                  className="flex min-h-14 items-center gap-2.5 px-3 py-1.5"
                >
                  {l.imageUrl || l.image ? (
                    <ArticleThumb image={l.imageUrl ?? l.image ?? null} name={l.name} category={l.category} className="size-11" />
                  ) : (
                    <PhotoButton label={`Foto aufnehmen: ${l.name}`} onError={setError} onPhoto={(img) => savePhoto(l, img)} />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-medium leading-tight text-foreground [overflow-wrap:anywhere]">
                      {l.name}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[
                        l.unit,
                        l.counted != null && l.countedBy ? l.countedBy : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  {showBroken && (
                    <QtyInput
                      value={l.broken}
                      field="broken"
                      onCommit={(raw) => commit(l, "broken", raw)}
                      label={`Bruch ${l.name}`}
                      placeholder="Bruch"
                      invalid={invalid.has(`${l.id}-broken`)}
                      className="w-14 shrink-0 text-sm placeholder:text-xs"
                    />
                  )}
                  <QtyInput
                    value={l.counted}
                    field="counted"
                    onCommit={(raw) => commit(l, "counted", raw)}
                    label={`Ist ${l.name}`}
                    placeholder="Ist"
                    invalid={invalid.has(`${l.id}-counted`)}
                    className={cn(
                      "w-[72px] shrink-0 text-base font-medium",
                      l.counted != null && "border-success/50 bg-success/5",
                    )}
                  />
                </li>
              ))}
            </ul>
          </Card>
        )}

        {!(filtered.length === 0 && q.trim()) && (
          <Button
            type="button"
            variant="outline"
            className="h-11 w-full"
            onClick={() => setAdding(true)}
          >
            <Plus className="h-4 w-4" />
            Artikel fehlt? Hinzufügen
          </Button>
        )}

        {adding && (
          <AddArticleDialog
            open
            onOpenChange={setAdding}
            token={token}
            counter={name}
            initialName={q.trim()}
            categories={categories}
            onAdded={(line) => {
              setData((d) => d && { ...d, lines: [...d.lines, line] });
              setQ(line.name);
              setCategory("");
              setView("all");
            }}
            onExisting={(id) => {
              const line = lines.find((l) => l.id === id);
              if (line) {
                setQ(line.name);
                setCategory("");
                setView("all");
              }
            }}
          />
        )}

        <p className="pb-4 text-center text-xs text-muted-foreground">
          Eingaben werden sofort gespeichert. Enter springt zum nächsten
          Artikel.
          {data.expiresAt &&
            ` Link gültig bis ${new Date(data.expiresAt).toLocaleDateString("de-DE")}.`}
        </p>
      </div>
    </Shell>
  );
}
