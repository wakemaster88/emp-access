"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ClipboardList, Loader2, ShieldAlert, UserRound, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { IconChip, type ChipTone } from "@/components/ui/icon-chip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { NativeSelect } from "@/components/ui/native-select";
import { SearchInput } from "@/components/ui/search-input";
import { Segmented } from "@/components/ui/segmented";
import { ArticleThumb } from "./article-visual";
import { QtyInput, type Field } from "./qty-input";
import { parseGermanNumber } from "@/lib/warenwirtschaft";

interface Line {
  id: number;
  name: string;
  sku: string | null;
  category: string;
  unit: string | null;
  counted: number | null;
  broken: number | null;
  countedBy: string | null;
  image: string | null;
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

const NAME_KEY = "wawi-count-name";
const REFRESH_MS = 30_000;

function readName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* privates Fenster: Name gilt nur für diese Sitzung */
  }
}

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
  const [name, setName] = useState(() => (typeof window === "undefined" ? "" : readName()));
  const [nameDraft, setNameDraft] = useState(name);
  const [view, setView] = useState<View>("open");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [saving, setSaving] = useState(0);
  const [error, setError] = useState("");
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/zaehlen/${token}`, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setGone(body?.error ?? "Dieser Link ist nicht mehr gültig.");
        return;
      }
      // Während gespeichert wird, nicht mit dem älteren Serverstand überschreiben.
      if (pending.current === 0) setData(body as Payload);
    } catch {
      /* offline: beim nächsten Abgleich wieder versuchen */
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible" && !document.activeElement?.matches("input[data-count-input]")) void load();
    }, REFRESH_MS);
    const onVisible = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const lines = useMemo(() => data?.lines ?? [], [data]);
  const categories = useMemo(() => [...new Set(lines.map((l) => l.category))], [lines]);
  const countedCount = lines.filter((l) => l.counted != null).length;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return lines.filter((l) => {
      if (category && l.category !== category) return false;
      if (needle && !l.name.toLowerCase().includes(needle) && !l.sku?.toLowerCase().includes(needle)) return false;
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
      setData((d) => d && { ...d, lines: d.lines.map((l) => (l.id === line.id ? { ...l, [field]: parsed, countedBy: name } : l)) });
      pending.current += 1;
      setSaving((n) => n + 1);
      setError("");
      queue.current = queue.current.then(async () => {
        try {
          const res = await fetch(`/api/zaehlen/${token}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, lines: [{ id: line.id, [field]: parsed }] }),
          });
          if (res.status === 404 || res.status === 410) {
            const body = await res.json().catch(() => null);
            setGone(body?.error ?? "Dieser Link ist nicht mehr gültig.");
            return;
          }
          if (!res.ok) throw new Error();
        } catch {
          setError("Speichern fehlgeschlagen. Prüfe die Verbindung und gib den Wert erneut ein.");
        } finally {
          pending.current -= 1;
          setSaving((n) => n - 1);
        }
      });
    },
    [name, token],
  );

  if (gone) {
    return (
      <Shell accountName={data?.accountName}>
        <StateCard icon={ShieldAlert} tone="neutral" title="Zählen nicht möglich" text={gone} />
      </Shell>
    );
  }

  if (loading || !data) {
    return (
      <Shell>
        <Card className="flex-row items-center justify-center gap-2 py-16 text-sm text-muted-foreground sm:py-16">
          <Loader2 className="h-5 w-5 animate-spin" />
          Lädt …
        </Card>
      </Shell>
    );
  }

  const dateLabel = new Date(data.date).toLocaleDateString("de-DE", { timeZone: "UTC" });

  if (!name) {
    return (
      <Shell accountName={data.accountName}>
        <Card>
          <CardContent className="space-y-4 py-2">
            <div className="flex items-center gap-3">
              <IconChip icon={ClipboardList} tone="primary" size="lg" />
              <div className="min-w-0">
                <p className="font-semibold text-foreground [overflow-wrap:anywhere]">{data.title}</p>
                <p className="text-sm text-muted-foreground">
                  {data.kind === "CUTOFF" ? "Stichtag" : "Zähltag"} {dateLabel} · {data.lines.length} Artikel
                </p>
              </div>
            </div>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                const n = nameDraft.trim().slice(0, 60);
                if (!n) return;
                saveName(n);
                setName(n);
              }}
            >
              <div className="space-y-1.5">
                <Label htmlFor="count-name">Dein Name</Label>
                <Input id="count-name" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} autoComplete="name" autoFocus className="h-11" maxLength={60} />
                <p className="text-xs text-muted-foreground">Damit sieht das Büro, wer was gezählt hat.</p>
              </div>
              <Button type="submit" className="h-11 w-full" disabled={!nameDraft.trim()}>
                Zählen starten
              </Button>
            </form>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  const done = countedCount === data.lines.length;

  return (
    <Shell accountName={data.accountName}>
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-foreground [overflow-wrap:anywhere]">{data.title}</h1>
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

        <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${data.lines.length ? (countedCount / data.lines.length) * 100 : 0}%` }} />
        </div>

        <div className="sticky top-0 z-10 -mx-4 space-y-2 bg-background/95 px-4 py-2 backdrop-blur">
          <SearchInput value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ("")} placeholder="Artikel suchen" aria-label="Artikel suchen" className="h-11" />
          {categories.length > 1 && (
            <NativeSelect value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Kategorie" className="h-11">
              <option value="">Alle Kategorien</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </NativeSelect>
          )}
          <Segmented
            aria-label="Ansicht"
            stretch
            value={view}
            onValueChange={setView}
            options={[
              { value: "open", label: "Offen", count: data.lines.length - countedCount },
              { value: "counted", label: "Gezählt", count: countedCount },
              { value: "all", label: "Alle" },
            ]}
          />
        </div>

        {error && <Notice tone="danger" compact role="alert" title={error} />}

        {filtered.length === 0 ? (
          done && view === "open" && !q && !category ? (
            <StateCard icon={CheckCircle2} tone="success" title="Alles gezählt" text="Danke! Alle Artikel haben eine Menge. Das Büro schreibt die Inventur fest." />
          ) : (
            <Card className="py-10 text-center text-sm text-muted-foreground sm:py-10">Keine Artikel in dieser Ansicht</Card>
          )
        ) : (
          <Card flush>
            <ul className="divide-y divide-border">
              {filtered.map((l) => (
                <li key={l.id} className="flex items-center gap-3 px-3 py-2.5">
                  <ArticleThumb image={l.image} name={l.name} category={l.category} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground [overflow-wrap:anywhere]">{l.name}</p>
                    <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                      {[l.unit, l.counted != null && l.countedBy ? `gezählt von ${l.countedBy}` : null].filter(Boolean).join(" · ")}
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Bruch</span>
                      <QtyInput value={l.broken} field="broken" onCommit={(raw) => commit(l, "broken", raw)} label={`Bruch ${l.name}`} invalid={invalid.has(`${l.id}-broken`)} className="h-9 w-16" />
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-xs text-muted-foreground">Ist</span>
                    <QtyInput value={l.counted} field="counted" onCommit={(raw) => commit(l, "counted", raw)} label={`Ist ${l.name}`} invalid={invalid.has(`${l.id}-counted`)} className="w-20" />
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <p className="pb-4 text-center text-xs text-muted-foreground">
          Eingaben werden sofort gespeichert. Enter springt zum nächsten Artikel.
          {data.expiresAt && ` Link gültig bis ${new Date(data.expiresAt).toLocaleDateString("de-DE")}.`}
        </p>
      </div>
    </Shell>
  );
}

function Shell({ children, accountName }: { children: React.ReactNode; accountName?: string }) {
  return (
    <main className="page-ambient min-h-dvh px-4 py-6">
      <div className="mx-auto w-full max-w-xl">
        {accountName && <p className="text-label mb-3">{accountName}</p>}
        {children}
      </div>
    </main>
  );
}

function StateCard({ icon, tone, title, text }: { icon: LucideIcon; tone: ChipTone; title: string; text: string }) {
  return (
    <Card className="items-center gap-3 px-6 py-10 text-center sm:py-10">
      <IconChip icon={icon} tone={tone} size="lg" className="size-14 rounded-tile [&_svg]:size-7" />
      <p className="text-base font-semibold text-foreground">{title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{text}</p>
    </Card>
  );
}
