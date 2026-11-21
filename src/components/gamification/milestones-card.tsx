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
import { Textarea } from "@/components/ui/textarea";
import { Award, CalendarPlus, Loader2, Plus, Save, Trash2, X } from "lucide-react";
import { awardText } from "@/lib/awards";
import {
  EMPTY_SKILL_REWARD, SkillRewardField, skillRewardBody, skillRewardState, skillRewardValid,
  type SkillChoice, type SkillRewardState,
} from "./skill-reward-field";
import {
  GAMI_METRICS, GAMI_PERIODS, GAMI_TIERS, METRIC_LABEL, PERIOD_LABEL, TIER_LABEL, formatDegrees, milestoneConditionText,
  openingDayOf,
  type GamiMetric, type GamiPeriod, type GamiTier,
} from "@/lib/gamification";

export interface MilestoneRow {
  id: number;
  name: string;
  metric: GamiMetric;
  threshold: number;
  period: GamiPeriod;
  voucherLabel: string | null;
  voucherValidDays: number | null;
  voucherShort: string | null;
  bonus: string | null;
  tier: GamiTier;
  hint: string | null;
  /** Eingetragene Tage als "YYYY-MM-DD" (Zählarten „Aktionstage“ und „Erster Tag der Saison“). */
  eventDays: string[];
  /** Grenze der Wassertemperatur in °C (Zählart „Tage mit kaltem Wasser“). */
  tempBelow: number | null;
  skillId: number | null;
  skillUses: number;
  skillValidDays: number | null;
  /** Name des Skills für die Liste. */
  skillName: string | null;
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
  voucherShort: string;
  bonus: string;
  tier: GamiTier;
  hint: string;
  eventDays: string[];
  newEventDay: string;
  tempBelow: string;
  skill: SkillRewardState;
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
  voucherValidDays: "365",
  voucherShort: "",
  bonus: "",
  tier: "BRONZE",
  hint: "",
  eventDays: [],
  newEventDay: "",
  tempBelow: "10",
  skill: EMPTY_SKILL_REWARD,
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
    voucherShort: m.voucherShort ?? "",
    bonus: m.bonus ?? "",
    tier: m.tier,
    hint: m.hint ?? "",
    eventDays: m.eventDays,
    newEventDay: "",
    tempBelow: m.tempBelow != null ? String(m.tempBelow) : "10",
    skill: skillRewardState(m),
    active: m.active,
  };
}

const fmtYmd = (ymd: string) => `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}.${ymd.slice(0, 4)}`;

/** Fehlt bei der Zählart „Aktionstage“ ein Tag in der laufenden Saison, kann niemand den Award holen. */
function missingEventDay(m: { metric: GamiMetric; eventDays: string[] }, today: string): boolean {
  return m.metric === "EVENT_DAYS" && !m.eventDays.some((d) => d.startsWith(today.slice(0, 4)));
}

/** Der Fühler für die Wassertemperatur aus den Einstellungen. */
export interface WaterSensorInfo {
  name: string;
  /** Zuletzt gemessene Temperatur in °C, wenn es einen frischen Wert gibt. */
  now: number | null;
}

/** Eingabe der Grad-Grenze lesen; null bei leer oder Unsinn. */
function parseDegrees(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (!/^-?\d{1,2}(\.\d)?$/.test(t)) return null;
  const n = Number(t);
  return n >= -5 && n <= 40 ? n : null;
}

/**
 * Awards (Meilensteine) anlegen und ändern: Ziel, Seltenheit und optional ein
 * Leistungs-Gutschein. `today` ist der heutige Tag in Europe/Berlin,
 * `openingDay` der automatisch ermittelte erste Tag der laufenden Saison und
 * `waterSensor` der gewählte Fühler (null = keiner gewählt).
 */
export function MilestonesCard({
  milestones, today, openingDay, waterSensor, skills = [],
}: {
  milestones: MilestoneRow[];
  /** Skills, die als Belohnung zur Wahl stehen. */
  skills?: SkillChoice[];
  today: string;
  openingDay: string | null;
  waterSensor: WaterSensorInfo | null;
}) {
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

  const year = today.slice(0, 4);
  const threshold = form?.metric === "OPENING_DAY" ? 1 : Number(form?.threshold);
  const tempBelow = form?.metric === "COLD_DAYS" ? parseDegrees(form.tempBelow) : null;
  const validDays = form?.voucherValidDays.trim() ? Number(form.voucherValidDays) : null;
  const valid =
    !!form &&
    form.name.trim().length > 0 &&
    Number.isInteger(threshold) && threshold >= 1 &&
    (form.metric !== "COLD_DAYS" || tempBelow != null) &&
    (!form.withVoucher || form.voucherLabel.trim().length > 0) &&
    (validDays == null || (Number.isInteger(validDays) && validDays >= 1)) &&
    skillRewardValid(form.skill);

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
            period: form.metric === "SEASONS" ? "ALL_TIME" : form.period,
            voucherLabel: form.withVoucher ? form.voucherLabel.trim() : null,
            voucherValidDays: form.withVoucher ? validDays : null,
            voucherShort: form.withVoucher ? form.voucherShort.trim() : null,
            bonus: form.bonus.trim(),
            tier: form.tier,
            hint: form.hint.trim(),
            eventDays: form.metric === "EVENT_DAYS" || form.metric === "OPENING_DAY" ? form.eventDays : [],
            tempBelow,
            ...skillRewardBody(form.skill),
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

  const addEventDay = (day: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
    setForm((f) => (f ? { ...f, eventDays: [...new Set([...f.eventDays, day])].sort(), newEventDay: "" } : f));
  };

  return (
    <>
      <Card flush>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Award className="h-4 w-4 text-primary shrink-0" />
            Awards ({milestones.length})
          </CardTitle>
          <CardDescription>
            Ziel erreicht: Award einmal, dazu der Gutschein. Aktive Awards zeigt die App als Abzeichen.
          </CardDescription>
          <CardAction>
            <Button onClick={() => open(EMPTY)} className="max-sm:h-11" aria-label="Award anlegen">
              <Plus className="h-4 w-4" />
              <span>Award<span className="max-sm:sr-only"> anlegen</span></span>
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
                title="Noch keine Awards"
                description="Lege zum Beispiel „Regular“ für 5 Besuchstage in der Saison an."
                compact={false}
              />
            )}
            {milestones.map((m) => (
              <TableRow key={m.id} className="cursor-pointer max-sm:h-11" onClick={() => open(toForm(m))}>
                <TableCell className="max-sm:whitespace-normal">
                  <span className="font-medium text-foreground">{m.name}</span>
                  <span className="text-muted-foreground"> · {TIER_LABEL[m.tier]}</span>
                  <div className="sm:hidden text-xs text-muted-foreground">{milestoneConditionText(m)}</div>
                  {m.active && missingEventDay(m, today) && (
                    <div className="text-xs text-warning">Kein Aktionstag für {year} eingetragen</div>
                  )}
                  {m.active && m.metric === "COLD_DAYS" && !waterSensor && (
                    <div className="text-xs text-warning">Kein Fühler für die Wassertemperatur gewählt</div>
                  )}
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
                  {m.skillName && <div className="text-xs text-muted-foreground">Skill: {m.skillName} · {m.skillUses}×</div>}
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
            <DialogTitle>{form?.id == null ? "Award anlegen" : "Award bearbeiten"}</DialogTitle>
            <DialogDescription>
              Gezählt wird je Person. Eine Saison ist das Kalenderjahr, „Gesamt“ zählt über alle Jahre.
            </DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
                <div className="space-y-1.5">
                  <Label htmlFor="ms-name">Name</Label>
                  <Input id="ms-name" value={form.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} className="max-sm:h-11" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ms-tier">Seltenheit</Label>
                  <NativeSelect id="ms-tier" value={form.tier} onChange={(e) => set({ tier: e.target.value as GamiTier })}>
                    {GAMI_TIERS.map((t) => <option key={t} value={t}>{TIER_LABEL[t]}</option>)}
                  </NativeSelect>
                </div>
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
                  <Input
                    id="ms-threshold"
                    type="number"
                    min={1}
                    inputMode="numeric"
                    value={form.metric === "OPENING_DAY" ? "1" : form.threshold}
                    disabled={form.metric === "OPENING_DAY"}
                    onChange={(e) => set({ threshold: e.target.value })}
                    className="max-sm:h-11"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ms-period">Zeitraum</Label>
                  <NativeSelect
                    id="ms-period"
                    value={form.metric === "SEASONS" ? "ALL_TIME" : form.period}
                    disabled={form.metric === "SEASONS"}
                    onChange={(e) => set({ period: e.target.value as GamiPeriod })}
                  >
                    {GAMI_PERIODS.map((p) => <option key={p} value={p}>{PERIOD_LABEL[p]}</option>)}
                  </NativeSelect>
                </div>
              </div>

              {form.metric === "EARLY_DAYS" && (
                <p className="text-xs text-muted-foreground">
                  Ein Tag zählt, wenn der erste Start der Person höchstens eine Stunde nach dem ersten Abo-Start des Tages liegt.
                </p>
              )}
              {form.metric === "SEASONS" && (
                <p className="text-xs text-muted-foreground">
                  Eine Saison zählt mit mindestens einem Besuchstag. Für Jahre vor der Zählung trägst du bei der Person unter Abos › Kundenkonten „Fährt seit“ ein.
                </p>
              )}
              {form.metric === "COLD_DAYS" && (
                <div className="space-y-1.5">
                  <Label htmlFor="ms-temp">Wasser kälter als (°C)</Label>
                  <Input
                    id="ms-temp"
                    inputMode="decimal"
                    value={form.tempBelow}
                    onChange={(e) => set({ tempBelow: e.target.value })}
                    aria-invalid={tempBelow == null}
                    className="w-28 max-sm:h-11"
                  />
                  <p className="text-xs text-muted-foreground">
                    Ein Tag zählt, wenn das Wasser kälter war, während die Person am Lift war: von einer Stunde vor ihrem ersten bis eine Stunde nach ihrem letzten Start. Der Award wird dann von selbst vergeben.
                    {waterSensor ? ` Gemessen wird mit dem Fühler „${waterSensor.name}“${waterSensor.now != null ? `, gerade ${formatDegrees(waterSensor.now)} °C` : ""}.` : ""}
                  </p>
                  {!waterSensor && (
                    <Notice tone="warning" compact title="Kein Fühler für die Wassertemperatur gewählt. Wähle ihn unter Einstellungen, sonst wird der Award nicht vergeben." />
                  )}
                </div>
              )}
              {form.metric === "OPENING_DAY" && (
                <p className="text-xs text-muted-foreground">
                  Den Award bekommt von selbst, wer am ersten Tag des Jahres startet, an dem ein Abo-Fahrer am Lift fährt.
                  {(() => {
                    const day = openingDayOf(year, form.eventDays, openingDay ? { [year]: openingDay } : undefined);
                    return day
                      ? ` ${year} ist das der ${fmtYmd(day)}.`
                      : ` Für ${year} steht kein Tag fest: Es ist noch niemand gefahren, oder die Zählung hat erst im Lauf der Saison begonnen.`;
                  })()}
                </p>
              )}
              {(form.metric === "EVENT_DAYS" || form.metric === "OPENING_DAY") && (
                <div className="space-y-1.5">
                  <Label htmlFor="ms-eventday">{form.metric === "OPENING_DAY" ? "Ersten Tag selbst festlegen (optional)" : "Aktionstage"}</Label>
                  <div className="flex flex-wrap gap-2">
                    <Input
                      id="ms-eventday"
                      type="date"
                      value={form.newEventDay}
                      onChange={(e) => set({ newEventDay: e.target.value })}
                      className="w-auto flex-1 min-w-36 max-sm:h-11"
                    />
                    <Button type="button" variant="outline" disabled={!form.newEventDay} onClick={() => addEventDay(form.newEventDay)} className="max-sm:h-11">
                      <CalendarPlus className="h-4 w-4" />
                      Hinzufügen
                    </Button>
                    <Button type="button" variant="outline" disabled={form.eventDays.includes(today)} onClick={() => addEventDay(today)} className="max-sm:h-11">
                      Heute
                    </Button>
                  </div>
                  {form.eventDays.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {form.eventDays.map((d) => (
                        <Badge key={d} variant="neutral" className="gap-1 font-normal tabular-nums">
                          {fmtYmd(d)}
                          <button
                            type="button"
                            aria-label={`${fmtYmd(d)} entfernen`}
                            className="-mr-1 rounded-full p-0.5 hover:bg-foreground/10"
                            onClick={() => set({ eventDays: form.eventDays.filter((x) => x !== d) })}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    {form.metric === "OPENING_DAY"
                      ? "Trägst du einen Tag ein, gilt er für sein Jahr anstelle des automatisch ermittelten Tags, zum Beispiel wenn vor dem Opening schon jemand zur Probe gefahren ist."
                      : "Wer an einem dieser Tage startet, bekommt den Award, je Saison einmal. Trag den Tag hier ein, auch am Tag selbst."}
                  </p>
                  {missingEventDay(form, today) && (
                    <Notice tone="warning" compact title={`Für ${year} ist noch kein Aktionstag eingetragen.`} />
                  )}
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="ms-hint">Beschreibung in der App</Label>
                <Textarea
                  id="ms-hint"
                  rows={2}
                  value={form.hint}
                  maxLength={160}
                  placeholder={Number.isInteger(threshold) && threshold >= 1 ? awardText({ metric: form.metric, threshold, period: form.metric === "SEASONS" ? "ALL_TIME" : form.period, tempBelow }) : undefined}
                  onChange={(e) => set({ hint: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">Leer lassen, dann steht dort der Text aus dem Ziel.</p>
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
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="ms-short">Kurztext für die Kachel</Label>
                    <Input id="ms-short" value={form.voucherShort} maxLength={24} placeholder="z. B. Bring a Friend" onChange={(e) => set({ voucherShort: e.target.value })} className="max-sm:h-11" />
                  </div>
                </div>
              )}

              <SkillRewardField id="ms-skill" value={form.skill} onChange={(v) => set({ skill: v })} skills={skills} />

              <div className="space-y-1.5">
                <Label htmlFor="ms-bonus">Zugabe ohne Gutschein</Label>
                <Input id="ms-bonus" value={form.bonus} maxLength={80} placeholder="z. B. Hall-of-Fame-Wand" onChange={(e) => set({ bonus: e.target.value })} className="max-sm:h-11" />
              </div>

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
