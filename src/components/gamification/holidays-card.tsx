"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { Segmented } from "@/components/ui/segmented";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { CalendarHeart, Loader2, Save } from "lucide-react";
import { HOLIDAY_MAX_DAYS_BEFORE, HOLIDAY_SHOW_LABEL, holidayDayLabel, type HolidayShowKind } from "@/lib/holidays";
import { berlinHour, berlinYmd } from "@/lib/berlin-day";
import { holidayAnnounceBlock, holidayPushText } from "@/lib/rider-announce-rules";
import { PushAnnounceField, type PushReach, type PushStatus } from "./push-announce-field";

export interface HolidayAdminRow {
  key: string;
  name: string;
  /** Gesetzlicher Feiertag in NRW. */
  legal: boolean;
  /** Vorschlag für die Überschrift. */
  greeting: string;
  /** Nächstes Datum, „YYYY-MM-DD“. */
  ymd: string;
  setting: {
    show: HolidayShowKind;
    title: string | null;
    text: string | null;
    voucherLabel: string | null;
    voucherValidDays: number | null;
    daysBefore: number;
    active: boolean;
    pushPlanned: boolean;
  } | null;
  /** Push für den nächsten Termin schon gesendet, sonst null. */
  push: PushStatus | null;
  /** Vergebene Feiertags-Gutscheine (alle Jahre). */
  gifts: number;
}

type Choice = "OFF" | HolidayShowKind;

interface FormState {
  row: HolidayAdminRow;
  choice: Choice;
  title: string;
  text: string;
  voucherLabel: string;
  voucherValidDays: string;
  daysBefore: string;
  push: boolean;
}

const CHOICES: { value: Choice; label: string }[] = [
  { value: "OFF", label: "Aus" },
  { value: "GREETING", label: "Gruß" },
  { value: "OFFER", label: "Angebot" },
  { value: "VOUCHER", label: "Gutschein" },
];

function formFor(row: HolidayAdminRow): FormState {
  const s = row.setting;
  return {
    row,
    choice: s && s.active ? s.show : "OFF",
    title: s?.title ?? "",
    text: s?.text ?? "",
    voucherLabel: s?.voucherLabel ?? "",
    voucherValidDays: s?.voucherValidDays != null ? String(s.voucherValidDays) : s ? "" : "30",
    daysBefore: String(s?.daysBefore ?? 0),
    // Wie bei Angeboten: beim ersten Einschalten standardmäßig mit Push.
    push: s ? s.pushPlanned : true,
  };
}

function statusOf(row: HolidayAdminRow): { label: string; on: boolean } {
  const s = row.setting;
  if (!s || !s.active) return { label: "aus", on: false };
  return { label: HOLIDAY_SHOW_LABEL[s.show], on: true };
}

/**
 * Feiertage in der Kunden-App: je Feiertag Aus, Gruß, Angebot oder Gutschein.
 * Die Einstellung gilt jedes Jahr wieder; das Datum rechnet die App selbst.
 */
export function HolidaysCard({ rows, reach }: { rows: HolidayAdminRow[]; reach: PushReach }) {
  const router = useRouter();
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (patch: Partial<FormState>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const days = Number(form?.daysBefore || 0);
  const valid =
    !!form &&
    Number.isInteger(days) && days >= 0 && days <= HOLIDAY_MAX_DAYS_BEFORE &&
    (form.choice !== "OFFER" || form.text.trim().length > 0) &&
    (form.choice !== "VOUCHER" || form.voucherLabel.trim().length > 0);

  async function save() {
    if (!form) return;
    setSaving(true);
    setError("");
    const off = form.choice === "OFF";
    const validDays = form.voucherValidDays.trim() ? Number(form.voucherValidDays) : null;
    try {
      const res = await fetch(`/api/gamification/holidays/${form.row.key}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // „Aus“ behält die letzte Art und die Texte für das nächste Einschalten.
          show: off ? form.row.setting?.show ?? "GREETING" : form.choice,
          title: form.title.trim() || null,
          text: form.text.trim() || null,
          voucherLabel: form.voucherLabel.trim() || null,
          voucherValidDays: validDays,
          daysBefore: days,
          active: !off,
          push: form.push,
        }),
      });
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

  const on = rows.filter((r) => statusOf(r).on).length;

  return (
    <>
      <Card flush>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarHeart className="h-4 w-4 text-primary shrink-0" />
            Feiertage ({on} an)
          </CardTitle>
          <CardDescription>
            Oben auf der Startseite der App. Je Feiertag ein Gruß, ein Angebot oder ein Gutschein für Abo-Kunden; gilt jedes Jahr.
          </CardDescription>
        </CardHeader>
        <Table edge>
          <TableHeader>
            <TableRow>
              <TableHead>Feiertag</TableHead>
              <TableHead className="hidden sm:table-cell">Nächster Termin</TableHead>
              <TableHead className="text-right">In der App</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const st = statusOf(r);
              return (
                <TableRow key={r.key} className="cursor-pointer max-sm:h-11" onClick={() => { setForm(formFor(r)); setError(""); }}>
                  <TableCell className="whitespace-normal">
                    <span className="font-medium text-foreground">{r.name}</span>
                    {st.on && r.setting && (
                      <div className="text-xs text-muted-foreground">
                        {r.setting.show === "VOUCHER" ? r.setting.voucherLabel : r.setting.title || r.greeting}
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground sm:hidden">{holidayDayLabel(r.ymd)}</div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{holidayDayLabel(r.ymd)} {r.ymd.slice(0, 4)}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant={st.on ? "success" : "neutral"} className="font-normal">{st.label}</Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!form} onOpenChange={(o) => !o && !saving && setForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form?.row.name}</DialogTitle>
            <DialogDescription>
              {form ? `Nächster Termin: ${holidayDayLabel(form.row.ymd)} ${form.row.ymd.slice(0, 4)}. Gilt jedes Jahr.` : ""}
            </DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>In der App zeigen</Label>
                <Segmented
                  aria-label="In der App zeigen"
                  value={form.choice}
                  onValueChange={(v) => set({ choice: v })}
                  options={CHOICES}
                  stretch
                />
              </div>

              {form.choice !== "OFF" && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="ho-title">Überschrift</Label>
                    <Input id="ho-title" value={form.title} maxLength={60} placeholder={form.row.greeting} onChange={(e) => set({ title: e.target.value })} className="max-sm:h-11" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ho-text">{form.choice === "OFFER" ? "Angebot" : "Text (optional)"}</Label>
                    <Input
                      id="ho-text"
                      value={form.text}
                      maxLength={300}
                      placeholder={form.choice === "OFFER" ? "Zum Beispiel: Heute 2 Stunden zum Preis von 1" : "Zum Beispiel: Wir wünschen dir schöne Tage."}
                      onChange={(e) => set({ text: e.target.value })}
                      className="max-sm:h-11"
                    />
                  </div>
                  {form.choice === "VOUCHER" && (
                    <div className="grid gap-4 grid-cols-[1fr_7rem]">
                      <div className="space-y-1.5 min-w-0">
                        <Label htmlFor="ho-voucher">Gutschein für</Label>
                        <Input id="ho-voucher" value={form.voucherLabel} maxLength={80} placeholder="Freigetränk" onChange={(e) => set({ voucherLabel: e.target.value })} className="max-sm:h-11" />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="ho-valid">Gültig (Tage)</Label>
                        <Input id="ho-valid" type="number" min={1} max={730} inputMode="numeric" value={form.voucherValidDays} placeholder="unbegrenzt" onChange={(e) => set({ voucherValidDays: e.target.value })} className="max-sm:h-11" />
                      </div>
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label htmlFor="ho-before">Schon vorher zeigen (Tage)</Label>
                    <Input id="ho-before" type="number" min={0} max={HOLIDAY_MAX_DAYS_BEFORE} inputMode="numeric" value={form.daysBefore} onChange={(e) => set({ daysBefore: e.target.value })} className="max-sm:h-11" />
                    <p className="text-xs text-muted-foreground">0 heißt nur am Feiertag selbst, höchstens {HOLIDAY_MAX_DAYS_BEFORE}.</p>
                  </div>
                  <PushAnnounceField
                    id="ho-push"
                    checked={form.push}
                    onChange={(v) => set({ push: v })}
                    preview={holidayPushText({
                      key: form.row.key,
                      show: form.choice,
                      title: form.title,
                      text: form.text,
                      voucherLabel: form.voucherLabel,
                    })}
                    reach={reach}
                    status={form.row.push}
                    hint="Jedes Jahr einmal, sobald der Feiertag in der App erscheint (ab 9 Uhr)."
                    block={holidayAnnounceBlock(
                      { key: form.row.key, active: true, daysBefore: days, pushPlanned: form.push, pushedYear: null },
                      berlinYmd(new Date()),
                      berlinHour(new Date()),
                    )}
                  />
                  {form.choice === "VOUCHER" && (
                    <Notice
                      tone="info"
                      compact
                      title="Jede Person mit gültigem Abo bekommt den Gutschein einmal, sobald sie die App im Zeitraum öffnet."
                    >
                      {form.row.gifts > 0 ? `Bisher ${form.row.gifts} vergeben.` : null}
                    </Notice>
                  )}
                </>
              )}

              {error && <Notice tone="danger" compact title={error} />}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setForm(null)} disabled={saving} className="max-sm:h-11">
                  Abbrechen
                </Button>
                <Button type="button" onClick={save} disabled={saving || !valid} className="min-w-24 max-sm:h-11">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="h-4 w-4" />Speichern</>}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
