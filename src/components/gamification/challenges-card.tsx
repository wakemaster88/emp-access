"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Notice } from "@/components/ui/notice";
import { Switch } from "@/components/ui/switch";
import {
  Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Bell, Eye, EyeOff, Loader2, Plus, Save, Swords, Trash2, X } from "lucide-react";
import { berlinHour } from "@/lib/berlin-day";
import { challengeAnnounceBlock, challengePushText } from "@/lib/rider-announce-rules";
import { PushAnnounceField, type PushReach } from "./push-announce-field";
import {
  CHALLENGE_KINDS, CHALLENGE_KIND_LABEL, CHALLENGE_METRICS, METRIC_LABEL, POLL_OPTIONS_MAX, POLL_OPTIONS_MIN,
  challengeConditionText, challengeCountsRides,
  type ChallengeKind, type ChallengePhase, type GamiMetric,
} from "@/lib/gamification";
import { votesText } from "@/lib/challenge-voting-rules";

export interface ChallengeAdminRow {
  id: number;
  name: string;
  description: string | null;
  kind: ChallengeKind;
  metric: GamiMetric;
  threshold: number | null;
  topCount: number | null;
  /** "YYYY-MM-DD" */
  startDate: string;
  endDate: string;
  voucherLabel: string | null;
  voucherValidDays: number | null;
  active: boolean;
  settled: boolean;
  phase: ChallengePhase;
  /** Fahrer mit mindestens einem Start im Zeitraum. */
  participants: number;
  winners: number;
  pushPlanned: boolean;
  /** ISO-Zeit des Push-Versands oder null. */
  pushedAt: string | null;
  pushSent: number | null;
  /** Abstimmung: Antworten mit Stand. */
  options: Array<{ label: string; votes: number; percent: number }>;
  /** Foto-Challenge: alle Fotos, auch ausgeblendete, meiste Stimmen zuerst. */
  entries: Array<{ id: number; name: string; votes: number; rank: number | null; hidden: boolean }>;
  /** Schon Stimmen oder Fotos: Art und Antworten bleiben fest. */
  started: boolean;
}

interface FormState {
  id: number | null;
  name: string;
  description: string;
  kind: ChallengeKind;
  metric: GamiMetric;
  threshold: string;
  topCount: string;
  startDate: string;
  endDate: string;
  withVoucher: boolean;
  voucherLabel: string;
  voucherValidDays: string;
  active: boolean;
  push: boolean;
  options: string[];
}

function toForm(c: ChallengeAdminRow): FormState {
  return {
    id: c.id,
    name: c.name,
    description: c.description ?? "",
    kind: c.kind,
    metric: c.metric,
    threshold: c.threshold != null ? String(c.threshold) : "5",
    topCount: c.topCount != null ? String(c.topCount) : "3",
    startDate: c.startDate,
    endDate: c.endDate,
    withVoucher: c.voucherLabel != null,
    voucherLabel: c.voucherLabel ?? "",
    voucherValidDays: c.voucherValidDays != null ? String(c.voucherValidDays) : "",
    active: c.active,
    push: c.pushPlanned,
    options: c.options.length > 0 ? c.options.map((o) => o.label) : ["", ""],
  };
}

/** Spalte „Dabei“: Fahrer mit Start, Fotos oder Stimmen. */
function participantsText(c: ChallengeAdminRow): string {
  if (c.kind === "PHOTO") return c.participants === 1 ? "1 Foto" : `${c.participants} Fotos`;
  if (c.kind === "POLL") return votesText(c.participants);
  return String(c.participants);
}

function fmt(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${d}.${m}.${y}`;
}

const PHASE: Record<ChallengePhase, { label: string; variant: "info" | "success" | "neutral" }> = {
  upcoming: { label: "geplant", variant: "info" },
  running: { label: "läuft", variant: "success" },
  ended: { label: "beendet", variant: "neutral" },
};

/**
 * Challenges anlegen und ändern: „Aufgabe erfüllt“, „Top X“, Foto-Challenge
 * (Fotos hochladen, die Fahrer stimmen ab) oder Abstimmung, je mit Zeitraum
 * und (außer der Abstimmung) optionalem Gutschein.
 */
export function ChallengesCard({
  challenges, today, reach,
}: { challenges: ChallengeAdminRow[]; today: string; reach: PushReach }) {
  const router = useRouter();
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");
  const [hiding, setHiding] = useState<number | null>(null);

  const empty: FormState = {
    id: null, name: "", description: "", kind: "TASK", metric: "VISIT_DAYS", threshold: "5", topCount: "3",
    startDate: today, endDate: today, withVoucher: true, voucherLabel: "", voucherValidDays: "30", active: true,
    push: true, options: ["", ""],
  };
  const open = (f: FormState) => {
    setForm(f);
    setError("");
    setConfirmDelete(false);
  };
  const set = (patch: Partial<FormState>) => setForm((f) => (f ? { ...f, ...patch } : f));

  const selected = form?.id != null ? challenges.find((c) => c.id === form.id) : undefined;
  const locked = !!selected?.settled;
  const started = !!selected?.started;
  const rides = form ? challengeCountsRides(form.kind) : true;
  const filledOptions = form ? form.options.map((o) => o.trim()).filter(Boolean) : [];
  const threshold = Number(form?.threshold);
  const topCount = Number(form?.topCount);
  const validDays = form?.voucherValidDays.trim() ? Number(form.voucherValidDays) : null;
  const valid =
    !!form &&
    form.name.trim().length > 0 &&
    (form.kind === "TASK"
      ? Number.isInteger(threshold) && threshold >= 1
      : form.kind === "POLL"
        ? filledOptions.length >= POLL_OPTIONS_MIN && new Set(filledOptions.map((o) => o.toLowerCase())).size === filledOptions.length
        : Number.isInteger(topCount) && topCount >= 1 && topCount <= 100) &&
    /^\d{4}-\d{2}-\d{2}$/.test(form.startDate) &&
    /^\d{4}-\d{2}-\d{2}$/.test(form.endDate) &&
    form.startDate <= form.endDate &&
    (form.kind === "POLL" || !form.withVoucher || form.voucherLabel.trim().length > 0) &&
    (validDays == null || (Number.isInteger(validDays) && validDays >= 1));

  async function save() {
    if (!form || !valid) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(
        form.id == null ? "/api/gamification/challenges" : `/api/gamification/challenges/${form.id}`,
        {
          method: form.id == null ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name.trim(),
            description: form.description.trim() || null,
            kind: form.kind,
            metric: form.metric,
            threshold: form.kind === "TASK" ? threshold : null,
            topCount: form.kind === "TOP_X" || form.kind === "PHOTO" ? topCount : null,
            startDate: form.startDate,
            endDate: form.endDate,
            voucherLabel: form.withVoucher && form.kind !== "POLL" ? form.voucherLabel.trim() : null,
            voucherValidDays: form.withVoucher && form.kind !== "POLL" ? validDays : null,
            active: form.active,
            options: form.kind === "POLL" ? filledOptions : undefined,
            push: form.push,
          }),
        },
      );
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(typeof json.error === "string" ? json.error : "Speichern fehlgeschlagen");
        return;
      }
      setForm(null);
      router.refresh();
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setSaving(false);
    }
  }

  async function toggleHidden(entryId: number, hidden: boolean) {
    setHiding(entryId);
    setError("");
    try {
      const res = await fetch(`/api/gamification/challenges/entries/${entryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hidden }),
      });
      if (!res.ok) setError("Ändern fehlgeschlagen");
      else router.refresh();
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setHiding(null);
    }
  }

  async function remove() {
    if (!form?.id) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/gamification/challenges/${form.id}`, { method: "DELETE" });
      if (!res.ok) {
        setError("Löschen fehlgeschlagen");
        return;
      }
      setForm(null);
      router.refresh();
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Card flush>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Swords className="h-4 w-4 text-primary shrink-0" />
            Challenges ({challenges.length})
          </CardTitle>
          <CardDescription>
            Aufgabe: jeder, der das Ziel schafft, gewinnt. Top X: die Besten nach dem Ende. Foto: die Fahrer stimmen über die Fotos ab. Abstimmung: Frage mit Antworten.
          </CardDescription>
          <CardAction>
            <Button onClick={() => open(empty)} className="max-sm:h-11" aria-label="Challenge anlegen">
              <Plus className="h-4 w-4" />
              <span>Challenge<span className="max-sm:sr-only"> anlegen</span></span>
            </Button>
          </CardAction>
        </CardHeader>
        <Table edge>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="hidden sm:table-cell">Bedingung</TableHead>
              <TableHead className="hidden md:table-cell">Zeitraum</TableHead>
              <TableHead className="hidden sm:table-cell text-right">Dabei</TableHead>
              <TableHead className="text-right">Gewinner</TableHead>
              <TableHead className="text-right">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {challenges.length === 0 && (
              <TableEmpty
                colSpan={6}
                icon={Swords}
                title="Noch keine Challenges"
                description="Lege zum Beispiel „5 Besuchstage im Mai“ als Aufgabe oder „Bester Sprung im Juli“ als Foto-Challenge an."
                compact={false}
              />
            )}
            {challenges.map((c) => (
              <TableRow key={c.id} className="cursor-pointer max-sm:h-11" onClick={() => open(toForm(c))}>
                <TableCell className="max-sm:whitespace-normal">
                  <span className="font-medium text-foreground">{c.name}</span>
                  {c.pushedAt && <Bell className="ml-1.5 inline h-3.5 w-3.5 text-muted-foreground" aria-label="Push gesendet" />}
                  <div className="text-xs text-muted-foreground md:hidden">
                    <span className="sm:hidden">{challengeConditionText(c)} · </span>
                    {fmt(c.startDate)} bis {fmt(c.endDate)}
                  </div>
                </TableCell>
                <TableCell className="hidden sm:table-cell">{challengeConditionText(c)}</TableCell>
                <TableCell className="hidden md:table-cell">{fmt(c.startDate)} bis {fmt(c.endDate)}</TableCell>
                <TableCell className="hidden sm:table-cell text-right tabular-nums">{participantsText(c)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {c.kind === "POLL" || ((c.kind === "TOP_X" || c.kind === "PHOTO") && !c.settled) ? "–" : c.winners}
                </TableCell>
                <TableCell className="text-right">
                  <Badge variant={c.active ? PHASE[c.phase].variant : "neutral"} className="font-normal">
                    {c.active ? PHASE[c.phase].label : "aus"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!form} onOpenChange={(o) => !o && !saving && setForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form?.id == null ? "Challenge anlegen" : "Challenge bearbeiten"}</DialogTitle>
            <DialogDescription>
              Der Zeitraum schließt Start- und Endtag ein.
            </DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-4">
              {locked && (
                <Notice tone="info" compact title="Diese Challenge ist ausgewertet. Die Gewinner stehen fest, ändern lassen sich nur noch Name, Beschreibung und der Schalter." />
              )}
              <div className="space-y-1.5">
                <Label htmlFor="ch-name">Name</Label>
                <Input id="ch-name" value={form.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} className="max-sm:h-11" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ch-desc">Beschreibung (optional)</Label>
                <Input id="ch-desc" value={form.description} maxLength={300} placeholder="Kurzer Satz für die App" onChange={(e) => set({ description: e.target.value })} className="max-sm:h-11" />
              </div>
              <div className={`grid gap-4 ${rides ? "sm:grid-cols-3" : form.kind === "PHOTO" ? "sm:grid-cols-2" : ""}`}>
                <div className="space-y-1.5">
                  <Label htmlFor="ch-kind">Art</Label>
                  <NativeSelect id="ch-kind" value={form.kind} disabled={locked || started} onChange={(e) => set({ kind: e.target.value as ChallengeKind })}>
                    {CHALLENGE_KINDS.map((k) => <option key={k} value={k}>{CHALLENGE_KIND_LABEL[k]}</option>)}
                  </NativeSelect>
                </div>
                {rides && (
                <div className="space-y-1.5">
                  <Label htmlFor="ch-metric">Zählt</Label>
                  <NativeSelect id="ch-metric" value={form.metric} disabled={locked} onChange={(e) => set({ metric: e.target.value as GamiMetric })}>
                    {CHALLENGE_METRICS.map((m) => <option key={m} value={m}>{METRIC_LABEL[m]}</option>)}
                  </NativeSelect>
                </div>
                )}
                {form.kind === "POLL" ? null : form.kind === "TASK" ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="ch-threshold">Schwelle</Label>
                    <Input id="ch-threshold" type="number" min={1} inputMode="numeric" disabled={locked} value={form.threshold} onChange={(e) => set({ threshold: e.target.value })} className="max-sm:h-11" />
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor="ch-top">{form.kind === "PHOTO" ? "Gewinner (beste Fotos)" : "Gewinner (Top X)"}</Label>
                    <Input id="ch-top" type="number" min={1} max={100} inputMode="numeric" disabled={locked} value={form.topCount} onChange={(e) => set({ topCount: e.target.value })} className="max-sm:h-11" />
                  </div>
                )}
              </div>
              <div className="grid gap-4 grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="ch-start">Start</Label>
                  <Input id="ch-start" type="date" disabled={locked} value={form.startDate} onChange={(e) => set({ startDate: e.target.value })} className="max-sm:h-11" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ch-end">Ende</Label>
                  <Input id="ch-end" type="date" disabled={locked} value={form.endDate} min={form.startDate} onChange={(e) => set({ endDate: e.target.value })} className="max-sm:h-11" />
                </div>
              </div>
              {(form.kind === "TOP_X" || form.kind === "PHOTO") && !locked && (
                <p className="text-xs text-muted-foreground">
                  {form.kind === "PHOTO"
                    ? "Im Zeitraum lädt jeder Fahrer ein Foto hoch und hat eine Stimme (nicht fürs eigene Foto). Die Stimmen sieht man erst nach dem Ende. Ausgewertet wird nach dem Endtag; bei Gleichstand auf dem letzten Gewinnerplatz gewinnen alle."
                    : "Ausgewertet wird nach dem Endtag. Liegen mehrere auf dem letzten Gewinnerplatz gleichauf, gewinnen alle."}
                </p>
              )}

              {form.kind === "POLL" && (
                <div className="space-y-2">
                  <Label>Antworten</Label>
                  {started && (
                    <Notice tone="info" compact title="Es gibt schon Stimmen, die Antworten bleiben deshalb, wie sie sind." />
                  )}
                  {form.options.map((o, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        aria-label={`Antwort ${i + 1}`}
                        value={o}
                        maxLength={60}
                        disabled={started}
                        placeholder={`Antwort ${i + 1}`}
                        onChange={(e) => set({ options: form.options.map((x, j) => (j === i ? e.target.value : x)) })}
                        className="max-sm:h-11"
                      />
                      {form.options.length > POLL_OPTIONS_MIN && !started && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Antwort ${i + 1} entfernen`}
                          onClick={() => set({ options: form.options.filter((_, j) => j !== i) })}
                          className="shrink-0 max-sm:h-11 max-sm:w-11"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                  {form.options.length < POLL_OPTIONS_MAX && !started && (
                    <Button type="button" variant="outline" size="sm" onClick={() => set({ options: [...form.options, ""] })} className="max-sm:h-11">
                      <Plus className="h-3.5 w-3.5" />
                      Antwort
                    </Button>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Der Name ist die Frage. Eine Stimme je Person, bis zum Ende änderbar; das Ergebnis sieht, wer abgestimmt hat.
                  </p>
                </div>
              )}

              {selected && selected.kind === "POLL" && form.kind === "POLL" && selected.options.length > 0 && (
                <div className="space-y-2">
                  <Label>Stand ({votesText(selected.participants)})</Label>
                  <div className="space-y-2">
                    {selected.options.map((o, i) => (
                      <div key={i} className="space-y-1">
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="min-w-0 break-words">{o.label}</span>
                          <span className="tabular-nums text-muted-foreground">{o.votes} · {o.percent} %</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden" aria-hidden>
                          <div className="h-full bg-primary" style={{ width: `${o.percent}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selected && selected.kind === "PHOTO" && form.kind === "PHOTO" && (
                <div className="space-y-2">
                  <Label>Fotos ({selected.entries.length})</Label>
                  {selected.entries.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Noch keine Fotos.</p>
                  ) : (
                    <ul className="divide-y divide-border rounded-[12px] border border-border">
                      {selected.entries.map((e) => (
                        <li key={e.id} className="flex items-center gap-3 p-2">
                          <a href={`/api/gamification/challenges/entries/${e.id}/photo`} target="_blank" rel="noreferrer" className="shrink-0" aria-label={`Foto von ${e.name} öffnen`}>
                            {/* eslint-disable-next-line @next/next/no-img-element -- Foto aus der eigenen Schnittstelle */}
                            <img src={`/api/gamification/challenges/entries/${e.id}/photo`} alt="" className={`h-12 w-12 rounded-[10px] object-cover ${e.hidden ? "opacity-40" : ""}`} />
                          </a>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-foreground">{e.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {e.hidden ? "ausgeblendet" : `${votesText(e.votes)}${e.rank != null ? ` · Platz ${e.rank}` : ""}`}
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={hiding === e.id || locked}
                            onClick={() => toggleHidden(e.id, !e.hidden)}
                            className="shrink-0 max-sm:h-11"
                          >
                            {hiding === e.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : e.hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                            {e.hidden ? "Einblenden" : "Ausblenden"}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Die KI prüft jedes Foto vor dem Hochladen. Ausgeblendete Fotos sieht nur die Person selbst, sie zählen nicht mit.
                  </p>
                </div>
              )}

              {form.kind !== "POLL" && (
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="ch-voucher">Gutschein ausgeben</Label>
                <Switch id="ch-voucher" checked={form.withVoucher} disabled={locked} onCheckedChange={(v) => set({ withVoucher: v })} />
              </div>
              )}
              {form.withVoucher && form.kind !== "POLL" && (
                <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
                  <div className="space-y-1.5">
                    <Label htmlFor="ch-label">Leistung auf dem Gutschein</Label>
                    <Input id="ch-label" value={form.voucherLabel} maxLength={80} disabled={locked} placeholder="z. B. Freigetränk" onChange={(e) => set({ voucherLabel: e.target.value })} className="max-sm:h-11" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ch-days">Gültig (Tage)</Label>
                    <Input id="ch-days" type="number" min={1} inputMode="numeric" disabled={locked} value={form.voucherValidDays} placeholder="unbegrenzt" onChange={(e) => set({ voucherValidDays: e.target.value })} className="max-sm:h-11" />
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="ch-active">Aktiv</Label>
                <Switch id="ch-active" checked={form.active} onCheckedChange={(v) => set({ active: v })} />
              </div>

              {!locked && (
                <PushAnnounceField
                  id="ch-push"
                  checked={form.push}
                  onChange={(v) => set({ push: v })}
                  preview={challengePushText(
                    {
                      name: form.name.trim() || "Name",
                      description: form.description,
                      kind: form.kind,
                      metric: form.metric,
                      threshold: form.kind === "TASK" ? threshold || 0 : null,
                      topCount: form.kind === "TOP_X" || form.kind === "PHOTO" ? topCount || 0 : null,
                      startYmd: form.startDate,
                      endYmd: form.endDate,
                      voucherLabel: form.kind !== "POLL" && form.withVoucher && form.voucherLabel.trim() ? form.voucherLabel.trim() : null,
                    },
                    today,
                  )}
                  reach={reach}
                  status={selected ? { pushedAt: selected.pushedAt, pushSent: selected.pushSent } : null}
                  block={challengeAnnounceBlock(
                    { name: form.name, active: form.active, startYmd: form.startDate, endYmd: form.endDate, pushPlanned: form.push, pushedAt: null },
                    today,
                    berlinHour(new Date()),
                  )}
                />
              )}

              {error && <Notice tone="danger" compact title={error} />}

              {confirmDelete && (
                <Notice
                  tone="danger"
                  compact
                  title={
                    selected && selected.winners > 0
                      ? `„${form.name}“ hat schon ${selected.winners} Gewinner und wird deshalb nur abgeschaltet.`
                      : `„${form.name}“ wirklich löschen?`
                  }
                  action={
                    <Button type="button" variant="destructive" size="sm" onClick={remove} disabled={saving} className="max-sm:h-11">
                      <Trash2 className="h-3.5 w-3.5" />
                      {selected && selected.winners > 0 ? "Abschalten" : "Endgültig löschen"}
                    </Button>
                  }
                />
              )}

              <DialogFooter
                start={form.id != null ? (
                  <Button type="button" variant="ghost" onClick={() => setConfirmDelete(true)} disabled={saving} className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 max-sm:h-11">
                    <Trash2 className="h-4 w-4" />
                    Löschen
                  </Button>
                ) : null}
              >
                <Button type="button" variant="outline" onClick={() => setForm(null)} disabled={saving} className="max-sm:h-11">
                  Abbrechen
                </Button>
                <Button type="button" onClick={save} disabled={saving || !valid} className="min-w-24 max-sm:h-11">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="h-4 w-4" />{form.id == null ? "Erstellen" : "Speichern"}</>}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
