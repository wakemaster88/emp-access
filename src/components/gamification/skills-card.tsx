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
import { History, Loader2, Plus, Save, Trash2, Zap } from "lucide-react";
import { MAX_SKILL_COOLDOWN, MAX_SKILL_MINUTES, runText, skillRunSeconds, type SkillKind } from "@/lib/rider-skill-rules";

export interface SkillAdminRow {
  id: number;
  name: string;
  description: string | null;
  kind: SkillKind;
  deviceId: number | null;
  deviceName: string | null;
  minutes: number;
  cooldownMinutes: number;
  onlyOperating: boolean;
  onlyOnSite: boolean;
  paused: boolean;
  active: boolean;
  /** Nutzungen, die vergeben und noch offen sind. */
  openUses: number;
  /** Ausgelöst in den letzten 30 Tagen. */
  uses30: number;
}

export interface SkillDeviceOption {
  id: number;
  name: string;
  category: string | null;
  pulseSeconds: number | null;
}

export interface SkillUseRow {
  id: number;
  at: string;
  skill: string;
  who: string;
  ok: boolean;
  error: string | null;
}

interface FormState {
  id: number | null;
  name: string;
  description: string;
  kind: SkillKind;
  deviceId: string;
  minutes: string;
  cooldownMinutes: string;
  onlyOperating: boolean;
  onlyOnSite: boolean;
  paused: boolean;
  active: boolean;
}

const EMPTY: FormState = {
  id: null, name: "", description: "", kind: "DEVICE", deviceId: "", minutes: "5", cooldownMinutes: "2",
  onlyOperating: true, onlyOnSite: true, paused: false, active: true,
};

const CATEGORY_LABEL: Record<string, string> = { TASTER: "Taster", SCHALTER: "Schalter", BELEUCHTUNG: "Licht" };

function clock(iso: string): string {
  return new Date(iso).toLocaleString("de-DE", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin",
  });
}

/**
 * Skills der Kunden-App: Geräte, die Fahrer als Belohnung selbst schalten
 * dürfen. Hier anlegen, sperren und sehen, wer wann geschaltet hat. Vergeben
 * werden sie an Awards, Challenges und Feiertagen.
 */
export function SkillsCard({
  skills, devices, uses, musicReady,
}: {
  skills: SkillAdminRow[];
  devices: SkillDeviceOption[];
  uses: SkillUseRow[];
  /** Playlist-Abstimmung ist eingerichtet (Grundlage des Musik-Jokers). */
  musicReady: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

  const open = (f: FormState) => {
    setForm(f);
    setError("");
    setConfirmDelete(false);
  };
  const set = (patch: Partial<FormState>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const device = form ? devices.find((d) => String(d.id) === form.deviceId) ?? null : null;
  const pulse = form?.kind === "DEVICE" && device?.category === "TASTER";
  const minutes = Number(form?.minutes);
  const cooldown = Number(form?.cooldownMinutes);
  const valid =
    !!form &&
    form.name.trim().length > 0 &&
    (form.kind === "MUSIC" || device != null) &&
    Number.isInteger(minutes) && minutes >= 1 && minutes <= MAX_SKILL_MINUTES &&
    Number.isInteger(cooldown) && cooldown >= 0 && cooldown <= MAX_SKILL_COOLDOWN;

  async function send(method: "POST" | "PATCH" | "DELETE") {
    if (!form) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(
        form.id == null ? "/api/gamification/skills" : `/api/gamification/skills/${form.id}`,
        method === "DELETE"
          ? { method }
          : {
              method,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name: form.name.trim(),
                description: form.description.trim() || null,
                kind: form.kind,
                deviceId: form.kind === "DEVICE" && form.deviceId ? Number(form.deviceId) : null,
                minutes,
                cooldownMinutes: cooldown,
                onlyOperating: form.onlyOperating,
                onlyOnSite: form.onlyOnSite,
                paused: form.paused,
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

  async function togglePause(s: SkillAdminRow, paused: boolean) {
    setToggling(s.id);
    try {
      await fetch(`/api/gamification/skills/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused }),
      });
      router.refresh();
    } finally {
      setToggling(null);
    }
  }

  return (
    <>
      <Card flush>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary shrink-0" />
            Skills ({skills.length})
          </CardTitle>
          <CardDescription>
            Fahrer schalten als Belohnung selbst, z. B. die Außendusche. Vergeben an Awards, Challenges und Feiertagen.
          </CardDescription>
          <CardAction>
            <Button onClick={() => open(EMPTY)} className="max-sm:h-11" aria-label="Skill anlegen">
              <Plus className="h-4 w-4" />
              <span>Skill<span className="max-sm:sr-only"> anlegen</span></span>
            </Button>
          </CardAction>
        </CardHeader>
        <Table edge>
          <TableHeader>
            <TableRow>
              <TableHead>Skill</TableHead>
              <TableHead className="hidden sm:table-cell text-right">Offen</TableHead>
              <TableHead className="text-right">Freigegeben</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {skills.length === 0 && (
              <TableEmpty
                colSpan={3}
                icon={Zap}
                title="Noch keine Skills"
                description="Zum Beispiel „Außendusche“: der Fahrer schaltet sie in der App 60 Sekunden ein."
                compact={false}
              />
            )}
            {skills.map((s) => (
              <TableRow key={s.id} className="max-sm:h-11">
                <TableCell
                  className="whitespace-normal cursor-pointer"
                  onClick={() => open({
                    id: s.id, name: s.name, description: s.description ?? "", kind: s.kind,
                    deviceId: s.deviceId != null ? String(s.deviceId) : "", minutes: String(s.minutes),
                    cooldownMinutes: String(s.cooldownMinutes), onlyOperating: s.onlyOperating,
                    onlyOnSite: s.onlyOnSite, paused: s.paused, active: s.active,
                  })}
                >
                  <span className="font-medium text-foreground">{s.name}</span>
                  {!s.active && <Badge variant="neutral" className="ml-1.5 font-normal">aus</Badge>}
                  <div className="text-xs text-muted-foreground">
                    {s.kind === "MUSIC" ? "Musik-Joker" : s.deviceName ?? "Gerät fehlt"}
                    {` · ${s.uses30}× in 30 Tagen`}
                    <span className="sm:hidden">{` · ${s.openUses} offen`}</span>
                  </div>
                </TableCell>
                <TableCell className="hidden sm:table-cell text-right tabular-nums">{s.openUses}</TableCell>
                <TableCell className="text-right">
                  <Switch
                    checked={!s.paused}
                    disabled={toggling === s.id || !s.active}
                    onCheckedChange={(v) => void togglePause(s, !v)}
                    aria-label={s.paused ? `${s.name} freigeben` : `${s.name} sperren`}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card flush>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-4 w-4 text-primary shrink-0" />
            Geschaltet
          </CardTitle>
          <CardDescription>Die letzten 30 Nutzungen. Fehlgeschlagene zählen nicht.</CardDescription>
        </CardHeader>
        <Table edge>
          <TableHeader>
            <TableRow>
              <TableHead>Wann</TableHead>
              <TableHead>Wer</TableHead>
              <TableHead className="text-right">Skill</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {uses.length === 0 && <TableEmpty colSpan={3} title="Noch nichts geschaltet." />}
            {uses.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="tabular-nums">{clock(u.at)}</TableCell>
                <TableCell className="max-sm:whitespace-normal">{u.who}</TableCell>
                <TableCell className="text-right max-sm:whitespace-normal">
                  {u.skill}
                  {!u.ok && <div className="text-xs text-destructive">{u.error ?? "fehlgeschlagen"}</div>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!form} onOpenChange={(o) => !o && !saving && setForm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form?.id == null ? "Skill anlegen" : "Skill bearbeiten"}</DialogTitle>
            <DialogDescription>Was der Fahrer schalten darf und welche Grenzen gelten.</DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="sk-name">Name in der App</Label>
                  <Input id="sk-name" value={form.name} maxLength={40} placeholder="z. B. Außendusche" onChange={(e) => set({ name: e.target.value })} className="max-sm:h-11" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sk-kind">Art</Label>
                  <NativeSelect id="sk-kind" value={form.kind} onChange={(e) => set({ kind: e.target.value as SkillKind })}>
                    <option value="DEVICE">Gerät schalten</option>
                    <option value="MUSIC">Musik-Joker</option>
                  </NativeSelect>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sk-desc">Satz dazu (optional)</Label>
                <Input id="sk-desc" value={form.description} maxLength={160} placeholder="z. B. Warm abduschen nach dem Fahren" onChange={(e) => set({ description: e.target.value })} className="max-sm:h-11" />
              </div>

              {form.kind === "DEVICE" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="sk-device">Gerät</Label>
                  <NativeSelect id="sk-device" value={form.deviceId} onChange={(e) => set({ deviceId: e.target.value })}>
                    <option value="">Bitte wählen</option>
                    {devices.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}{d.category ? ` (${CATEGORY_LABEL[d.category] ?? d.category})` : ""}
                      </option>
                    ))}
                  </NativeSelect>
                  <p className="text-xs text-muted-foreground">Nur Taster, Schalter und Licht. Türen, Tore und Ventile nie.</p>
                </div>
              ) : (
                !musicReady && <Notice tone="warning" compact title="Der Musik-Joker nutzt die Playlist-Abstimmung. Richte sie unter Einstellungen ein." />
              )}

              <div className="grid gap-4 grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="sk-min">{pulse ? "Läuft je Nutzung" : "Läuft je Nutzung (Min.)"}</Label>
                  {pulse ? (
                    <Input id="sk-min" disabled value={runText(skillRunSeconds({ kind: "DEVICE", minutes: 1 }, device))} className="max-sm:h-11" />
                  ) : (
                    <Input id="sk-min" type="number" min={1} max={MAX_SKILL_MINUTES} inputMode="numeric" value={form.minutes} onChange={(e) => set({ minutes: e.target.value })} className="max-sm:h-11" />
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sk-cool">Pause danach (Min.)</Label>
                  <Input id="sk-cool" type="number" min={0} max={MAX_SKILL_COOLDOWN} inputMode="numeric" value={form.cooldownMinutes} onChange={(e) => set({ cooldownMinutes: e.target.value })} className="max-sm:h-11" />
                </div>
              </div>
              {pulse && <p className="text-xs text-muted-foreground -mt-2">Ein Taster läuft so lange, wie am Gerät eingestellt.</p>}

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="sk-op">Nur während der Öffnungszeit am Lift</Label>
                  <Switch id="sk-op" checked={form.onlyOperating} onCheckedChange={(v) => set({ onlyOperating: v })} />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="sk-site">Nur wer heute schon gestartet ist</Label>
                  <Switch id="sk-site" checked={form.onlyOnSite} onCheckedChange={(v) => set({ onlyOnSite: v })} />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="sk-pause">Gesperrt</Label>
                  <Switch id="sk-pause" checked={form.paused} onCheckedChange={(v) => set({ paused: v })} />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="sk-active">Aktiv</Label>
                  <Switch id="sk-active" checked={form.active} onCheckedChange={(v) => set({ active: v })} />
                </div>
              </div>

              {error && <Notice tone="danger" compact title={error} />}
              {confirmDelete && (
                <Notice
                  tone="danger"
                  compact
                  title={`„${form.name}“ wirklich löschen? Schon vergebene Skills werden nur abgeschaltet.`}
                  action={
                    <Button type="button" variant="destructive" size="sm" onClick={() => send("DELETE")} disabled={saving} className="max-sm:h-11">
                      <Trash2 className="h-3.5 w-3.5" />
                      Löschen
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
                <Button type="button" onClick={() => send(form.id == null ? "POST" : "PATCH")} disabled={saving || !valid} className="min-w-24 max-sm:h-11">
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
