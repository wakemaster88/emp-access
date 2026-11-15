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
import { Award, Loader2, Plus, Save, Trash2 } from "lucide-react";
import {
  GAMI_METRICS, GAMI_PERIODS, METRIC_LABEL, PERIOD_LABEL, milestoneConditionText,
  type GamiMetric, type GamiPeriod,
} from "@/lib/gamification";

export interface MilestoneRow {
  id: number;
  name: string;
  metric: GamiMetric;
  threshold: number;
  period: GamiPeriod;
  voucherLabel: string | null;
  voucherValidDays: number | null;
  active: boolean;
  awarded: number;
  redeemed: number;
}

interface FormState {
  id: number | null;
  name: string;
  metric: GamiMetric;
  threshold: string;
  period: GamiPeriod;
  withVoucher: boolean;
  voucherLabel: string;
  voucherValidDays: string;
  active: boolean;
}

const EMPTY: FormState = {
  id: null,
  name: "",
  metric: "VISIT_DAYS",
  threshold: "10",
  period: "SEASON",
  withVoucher: true,
  voucherLabel: "",
  voucherValidDays: "30",
  active: true,
};

function toForm(m: MilestoneRow): FormState {
  return {
    id: m.id,
    name: m.name,
    metric: m.metric,
    threshold: String(m.threshold),
    period: m.period,
    withVoucher: m.voucherLabel != null,
    voucherLabel: m.voucherLabel ?? "",
    voucherValidDays: m.voucherValidDays != null ? String(m.voucherValidDays) : "",
    active: m.active,
  };
}

/** Meilensteine (Awards) anlegen und ändern; je Meilenstein optional ein Leistungs-Gutschein. */
export function MilestonesCard({ milestones }: { milestones: MilestoneRow[] }) {
  const router = useRouter();
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

  const open = (f: FormState) => {
    setForm(f);
    setError("");
    setConfirmDelete(false);
  };
  const set = (patch: Partial<FormState>) => setForm((f) => (f ? { ...f, ...patch } : f));

  const threshold = Number(form?.threshold);
  const validDays = form?.voucherValidDays.trim() ? Number(form.voucherValidDays) : null;
  const valid =
    !!form &&
    form.name.trim().length > 0 &&
    Number.isInteger(threshold) && threshold >= 1 &&
    (!form.withVoucher || form.voucherLabel.trim().length > 0) &&
    (validDays == null || (Number.isInteger(validDays) && validDays >= 1));

  async function save() {
    if (!form || !valid) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(
        form.id == null ? "/api/gamification/milestones" : `/api/gamification/milestones/${form.id}`,
        {
          method: form.id == null ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name.trim(),
            metric: form.metric,
            threshold,
            period: form.period,
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
      const res = await fetch(`/api/gamification/milestones/${form.id}`, { method: "DELETE" });
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

  const selected = form?.id != null ? milestones.find((m) => m.id === form.id) : undefined;

  return (
    <>
      <Card flush>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Award className="h-4 w-4 text-primary shrink-0" />
            Meilensteine ({milestones.length})
          </CardTitle>
          <CardDescription>
            Wer die Bedingung im Zeitraum erreicht, bekommt den Meilenstein einmal – und den Gutschein, wenn einer hinterlegt ist.
          </CardDescription>
          <CardAction>
            <Button onClick={() => open(EMPTY)} className="max-sm:h-11" aria-label="Meilenstein anlegen">
              <Plus className="h-4 w-4" />
              <span>Meilenstein<span className="max-sm:sr-only"> anlegen</span></span>
            </Button>
          </CardAction>
        </CardHeader>
        <Table edge>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="hidden sm:table-cell">Bedingung</TableHead>
              <TableHead className="hidden md:table-cell">Gutschein</TableHead>
              <TableHead className="text-right">Vergeben</TableHead>
              <TableHead className="hidden sm:table-cell text-right">Eingelöst</TableHead>
              <TableHead className="text-right">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {milestones.length === 0 && (
              <TableEmpty
                colSpan={6}
                icon={Award}
                title="Noch keine Meilensteine"
                description="Lege zum Beispiel „Stammfahrer“ für 10 Besuchstage in der Saison an."
                compact={false}
              />
            )}
            {milestones.map((m) => (
              <TableRow key={m.id} className="cursor-pointer max-sm:h-11" onClick={() => open(toForm(m))}>
                <TableCell className="max-sm:whitespace-normal">
                  <span className="font-medium text-foreground">{m.name}</span>
                  <div className="sm:hidden text-xs text-muted-foreground">{milestoneConditionText(m)}</div>
                </TableCell>
                <TableCell className="hidden sm:table-cell">{milestoneConditionText(m)}</TableCell>
                <TableCell className="hidden md:table-cell">
                  {m.voucherLabel ? (
                    <>
                      {m.voucherLabel}
                      <span className="text-muted-foreground">
                        {m.voucherValidDays ? ` · ${m.voucherValidDays} Tage gültig` : " · unbegrenzt"}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">kein Gutschein</span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{m.awarded}</TableCell>
                <TableCell className="hidden sm:table-cell text-right tabular-nums">
                  {m.voucherLabel ? m.redeemed : "–"}
                </TableCell>
                <TableCell className="text-right">
                  <Badge variant={m.active ? "success" : "neutral"} className="font-normal">
                    {m.active ? "aktiv" : "aus"}
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
            <DialogTitle>{form?.id == null ? "Meilenstein anlegen" : "Meilenstein bearbeiten"}</DialogTitle>
            <DialogDescription>
              Gezählt wird je Abo-Ticket. Eine Saison ist das Kalenderjahr.
            </DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="ms-name">Name</Label>
                <Input id="ms-name" value={form.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} className="max-sm:h-11" />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ms-metric">Zählt</Label>
                  <NativeSelect id="ms-metric" value={form.metric} onChange={(e) => set({ metric: e.target.value as GamiMetric })}>
                    {GAMI_METRICS.map((m) => <option key={m} value={m}>{METRIC_LABEL[m]}</option>)}
                  </NativeSelect>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ms-threshold">Schwelle</Label>
                  <Input id="ms-threshold" type="number" min={1} inputMode="numeric" value={form.threshold} onChange={(e) => set({ threshold: e.target.value })} className="max-sm:h-11" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ms-period">Zeitraum</Label>
                  <NativeSelect id="ms-period" value={form.period} onChange={(e) => set({ period: e.target.value as GamiPeriod })}>
                    {GAMI_PERIODS.map((p) => <option key={p} value={p}>{PERIOD_LABEL[p]}</option>)}
                  </NativeSelect>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="ms-voucher">Gutschein ausgeben</Label>
                <Switch id="ms-voucher" checked={form.withVoucher} onCheckedChange={(v) => set({ withVoucher: v })} />
              </div>
              {form.withVoucher && (
                <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
                  <div className="space-y-1.5">
                    <Label htmlFor="ms-label">Leistung auf dem Gutschein</Label>
                    <Input id="ms-label" value={form.voucherLabel} maxLength={80} placeholder="z. B. Freigetränk" onChange={(e) => set({ voucherLabel: e.target.value })} className="max-sm:h-11" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ms-days">Gültig (Tage)</Label>
                    <Input id="ms-days" type="number" min={1} inputMode="numeric" value={form.voucherValidDays} placeholder="unbegrenzt" onChange={(e) => set({ voucherValidDays: e.target.value })} className="max-sm:h-11" />
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="ms-active">Aktiv</Label>
                <Switch id="ms-active" checked={form.active} onCheckedChange={(v) => set({ active: v })} />
              </div>

              {error && <Notice tone="danger" compact title={error} />}

              {confirmDelete && (
                <Notice
                  tone="danger"
                  compact
                  title={
                    selected && selected.awarded > 0
                      ? `„${form.name}“ wurde schon ${selected.awarded}-mal vergeben und wird deshalb nur abgeschaltet.`
                      : `„${form.name}“ wirklich löschen?`
                  }
                  action={
                    <Button type="button" variant="destructive" size="sm" onClick={remove} disabled={saving} className="max-sm:h-11">
                      <Trash2 className="h-3.5 w-3.5" />
                      {selected && selected.awarded > 0 ? "Abschalten" : "Endgültig löschen"}
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
