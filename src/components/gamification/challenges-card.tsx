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
import { Loader2, Plus, Save, Swords, Trash2 } from "lucide-react";
import {
  CHALLENGE_KIND_LABEL, GAMI_METRICS, METRIC_LABEL, challengeConditionText,
  type ChallengeKind, type ChallengePhase, type GamiMetric,
} from "@/lib/gamification";

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
  };
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

/** Challenges anlegen und ändern: „Aufgabe erfüllt“ oder „Top X“, je mit Zeitraum und optionalem Gutschein. */
export function ChallengesCard({ challenges, today }: { challenges: ChallengeAdminRow[]; today: string }) {
  const router = useRouter();
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

  const empty: FormState = {
    id: null, name: "", description: "", kind: "TASK", metric: "VISIT_DAYS", threshold: "5", topCount: "3",
    startDate: today, endDate: today, withVoucher: true, voucherLabel: "", voucherValidDays: "30", active: true,
  };
  const open = (f: FormState) => {
    setForm(f);
    setError("");
    setConfirmDelete(false);
  };
  const set = (patch: Partial<FormState>) => setForm((f) => (f ? { ...f, ...patch } : f));

  const selected = form?.id != null ? challenges.find((c) => c.id === form.id) : undefined;
  const locked = !!selected?.settled;
  const threshold = Number(form?.threshold);
  const topCount = Number(form?.topCount);
  const validDays = form?.voucherValidDays.trim() ? Number(form.voucherValidDays) : null;
  const valid =
    !!form &&
    form.name.trim().length > 0 &&
    (form.kind === "TASK"
      ? Number.isInteger(threshold) && threshold >= 1
      : Number.isInteger(topCount) && topCount >= 1 && topCount <= 100) &&
    /^\d{4}-\d{2}-\d{2}$/.test(form.startDate) &&
    /^\d{4}-\d{2}-\d{2}$/.test(form.endDate) &&
    form.startDate <= form.endDate &&
    (!form.withVoucher || form.voucherLabel.trim().length > 0) &&
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
            topCount: form.kind === "TOP_X" ? topCount : null,
            startDate: form.startDate,
            endDate: form.endDate,
            voucherLabel: form.withVoucher ? form.voucherLabel.trim() : null,
            voucherValidDays: form.withVoucher ? validDays : null,
            active: form.active,
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
            Aufgabe erfüllt: jeder, der die Schwelle im Zeitraum schafft, gewinnt sofort. Top X: nach dem Ende gewinnen die Besten.
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
                description="Lege zum Beispiel „5 Besuchstage im Mai“ als Aufgabe an."
                compact={false}
              />
            )}
            {challenges.map((c) => (
              <TableRow key={c.id} className="cursor-pointer max-sm:h-11" onClick={() => open(toForm(c))}>
                <TableCell className="max-sm:whitespace-normal">
                  <span className="font-medium text-foreground">{c.name}</span>
                  <div className="text-xs text-muted-foreground md:hidden">
                    <span className="sm:hidden">{challengeConditionText(c)} · </span>
                    {fmt(c.startDate)} bis {fmt(c.endDate)}
                  </div>
                </TableCell>
                <TableCell className="hidden sm:table-cell">{challengeConditionText(c)}</TableCell>
                <TableCell className="hidden md:table-cell">{fmt(c.startDate)} bis {fmt(c.endDate)}</TableCell>
                <TableCell className="hidden sm:table-cell text-right tabular-nums">{c.participants}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {c.kind === "TOP_X" && !c.settled ? "–" : c.winners}
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
              Gezählt wird je Fahrer im Zeitraum, Start- und Endtag eingeschlossen.
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
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ch-kind">Art</Label>
                  <NativeSelect id="ch-kind" value={form.kind} disabled={locked} onChange={(e) => set({ kind: e.target.value as ChallengeKind })}>
                    {(["TASK", "TOP_X"] as const).map((k) => <option key={k} value={k}>{CHALLENGE_KIND_LABEL[k]}</option>)}
                  </NativeSelect>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ch-metric">Zählt</Label>
                  <NativeSelect id="ch-metric" value={form.metric} disabled={locked} onChange={(e) => set({ metric: e.target.value as GamiMetric })}>
                    {GAMI_METRICS.map((m) => <option key={m} value={m}>{METRIC_LABEL[m]}</option>)}
                  </NativeSelect>
                </div>
                {form.kind === "TASK" ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="ch-threshold">Schwelle</Label>
                    <Input id="ch-threshold" type="number" min={1} inputMode="numeric" disabled={locked} value={form.threshold} onChange={(e) => set({ threshold: e.target.value })} className="max-sm:h-11" />
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor="ch-top">Gewinner (Top X)</Label>
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
              {form.kind === "TOP_X" && !locked && (
                <p className="text-xs text-muted-foreground">
                  Ausgewertet wird nach dem Endtag. Liegen mehrere auf dem letzten Gewinnerplatz gleichauf, gewinnen alle.
                </p>
              )}

              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="ch-voucher">Gutschein ausgeben</Label>
                <Switch id="ch-voucher" checked={form.withVoucher} disabled={locked} onCheckedChange={(v) => set({ withVoucher: v })} />
              </div>
              {form.withVoucher && (
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
