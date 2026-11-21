"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { PushPreview } from "@/components/ui/push-preview";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { Cake, Loader2, Pencil, Save } from "lucide-react";
import { BIRTHDAY_DEFAULT_TITLE, birthdayPushText } from "@/lib/birthday";
import { isTestTitle } from "@/lib/rider-announce-rules";

export interface BirthdayAdminData {
  setting: {
    active: boolean;
    title: string | null;
    text: string | null;
    voucherLabel: string | null;
    voucherValidDays: number | null;
    pushPlanned: boolean;
    announceActive: boolean;
  } | null;
  /** Geburtstage heute und in den nächsten 7 Tagen (Profile mit Geburtsdatum). */
  today: number;
  week: number;
  /** Profile mit Geburtsdatum. */
  known: number;
  /** Geburtstags-Geschenke in diesem Jahr. */
  giftsYear: number;
  /** Geburtstags-Pushes in diesem Jahr. */
  pushesYear: number;
}

type Choice = "OFF" | "GREETING" | "GIFT";

const CHOICES: { value: Choice; label: string }[] = [
  { value: "OFF", label: "Aus" },
  { value: "GREETING", label: "Gruß" },
  { value: "GIFT", label: "Mit Geschenk" },
];

interface FormState {
  choice: Choice;
  title: string;
  text: string;
  voucherLabel: string;
  voucherValidDays: string;
  push: boolean;
}

function formFor(s: BirthdayAdminData["setting"]): FormState {
  return {
    choice: !s || !s.active ? "OFF" : s.voucherLabel ? "GIFT" : "GREETING",
    title: s?.title ?? "",
    text: s?.text ?? "",
    voucherLabel: s?.voucherLabel ?? "",
    voucherValidDays: s?.voucherValidDays != null ? String(s.voucherValidDays) : s ? "" : "30",
    push: s ? s.pushPlanned : true,
  };
}

/**
 * Geburtstag in der Kunden-App (Kunden App › Aktionen): am Geburtstag ein
 * Gruß oben auf der Startseite, auf Wunsch mit Geschenk-Gutschein für
 * Abo-Kunden, und ein Push an das Geburtstagskind.
 */
export function BirthdayCard({ data }: { data: BirthdayAdminData }) {
  const router = useRouter();
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const s = data.setting;
  const on = !!s?.active;

  const set = (patch: Partial<FormState>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const valid = !!form && (form.choice !== "GIFT" || form.voucherLabel.trim().length > 0);

  async function save() {
    if (!form) return;
    setSaving(true);
    setError("");
    const gift = form.choice === "GIFT";
    try {
      const res = await fetch("/api/gamification/birthday", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          active: form.choice !== "OFF",
          title: form.title.trim() || null,
          text: form.text.trim() || null,
          // „Gruß“ ohne Geschenk: Leistung leeren; „Aus“ behält alles fürs nächste Einschalten.
          voucherLabel: form.choice === "GREETING" ? null : form.voucherLabel.trim() || null,
          voucherValidDays: gift || form.choice === "OFF"
            ? (form.voucherValidDays.trim() ? Number(form.voucherValidDays) : null)
            : null,
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

  const summary = !on
    ? "Aus"
    : s?.voucherLabel
      ? `Gruß mit Geschenk: ${s.voucherLabel}`
      : `Gruß: ${s?.title || BIRTHDAY_DEFAULT_TITLE}`;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cake className="h-4 w-4 text-primary shrink-0" />
            Geburtstag
          </CardTitle>
          <CardDescription>
            Am Geburtstag oben auf der Startseite der App, mit Geschenk für Abo-Kunden. Das Geburtsdatum pflegt jede Person selbst im Profil.
          </CardDescription>
          <CardAction>
            <Button type="button" variant="outline" size="sm" onClick={() => { setForm(formFor(s)); setError(""); }} className="max-sm:h-11">
              <Pencil className="h-4 w-4" />
              Bearbeiten
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={on ? "success" : "neutral"} className="font-normal">{on ? "an" : "aus"}</Badge>
            {on && s?.pushPlanned && <Badge variant="secondary" className="font-normal">mit Push</Badge>}
            {s?.announceActive && <Badge variant="secondary" className="font-normal">Durchsage am Lift</Badge>}
            <span className="text-sm text-foreground min-w-0 break-words">{summary}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {[
              `Heute ${data.today}`,
              `nächste 7 Tage ${data.week}`,
              `${data.known} mit Geburtsdatum`,
              data.giftsYear > 0 ? `${data.giftsYear} ${data.giftsYear === 1 ? "Geschenk" : "Geschenke"} dieses Jahr` : null,
              data.pushesYear > 0 ? `${data.pushesYear} ${data.pushesYear === 1 ? "Push" : "Pushes"} dieses Jahr` : null,
            ].filter(Boolean).join(" · ")}
          </p>
        </CardContent>
      </Card>

      <Dialog open={!!form} onOpenChange={(o) => !o && !saving && setForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Geburtstag</DialogTitle>
            <DialogDescription>Gilt jedes Jahr, für jede Person am eigenen Geburtstag.</DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>In der App zeigen</Label>
                <Segmented aria-label="In der App zeigen" value={form.choice} onValueChange={(v) => set({ choice: v })} options={CHOICES} stretch />
              </div>

              {form.choice !== "OFF" && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="bd-title">Überschrift</Label>
                    <Input id="bd-title" value={form.title} maxLength={60} placeholder={BIRTHDAY_DEFAULT_TITLE} onChange={(e) => set({ title: e.target.value })} className="max-sm:h-11" />
                    <p className="text-xs text-muted-foreground">Der Vorname kommt von selbst dahinter, oder an die Stelle von {"{vorname}"}.</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="bd-text">Text (optional)</Label>
                    <Input id="bd-text" value={form.text} maxLength={300} placeholder="Zum Beispiel: Wir wünschen dir einen tollen Tag auf dem Wasser." onChange={(e) => set({ text: e.target.value })} className="max-sm:h-11" />
                  </div>
                  {form.choice === "GIFT" && (
                    <>
                      <div className="grid gap-4 grid-cols-[1fr_7rem]">
                        <div className="space-y-1.5 min-w-0">
                          <Label htmlFor="bd-voucher">Geschenk</Label>
                          <Input id="bd-voucher" value={form.voucherLabel} maxLength={80} placeholder="Freifahrt 1 Stunde" onChange={(e) => set({ voucherLabel: e.target.value })} className="max-sm:h-11" />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="bd-valid">Gültig (Tage)</Label>
                          <Input id="bd-valid" type="number" min={1} max={730} inputMode="numeric" value={form.voucherValidDays} placeholder="unbegrenzt" onChange={(e) => set({ voucherValidDays: e.target.value })} className="max-sm:h-11" />
                        </div>
                      </div>
                      <Notice tone="info" compact title="Jede Person mit gültigem Abo bekommt das Geschenk als Gutschein, sobald sie am Geburtstag die App öffnet. Einmal je Jahr." />
                    </>
                  )}

                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <Label htmlFor="bd-push">Push zum Geburtstag</Label>
                        <p className="text-xs text-muted-foreground">Einmal am Geburtstag zwischen 9 und 21 Uhr, nur an die Geräte des Geburtstagskinds. Bei Kindern ohne eigenes Gerät an die Eltern der Familie.</p>
                      </div>
                      <Switch id="bd-push" checked={form.push} onCheckedChange={(v) => set({ push: v })} />
                    </div>
                    {form.push && (
                      <>
                        <PushPreview
                          app="Ride Pass"
                          {...birthdayPushText(
                            { title: form.title, text: form.text, voucherLabel: form.choice === "GIFT" ? form.voucherLabel : null },
                            "Mia",
                          )}
                        />
                        {isTestTitle(form.title) && <Notice tone="warning" compact title="Überschrift beginnt mit „TEST:“, deshalb geht kein Push raus." />}
                      </>
                    )}
                  </div>
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
