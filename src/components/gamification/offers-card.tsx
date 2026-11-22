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
import { Notice } from "@/components/ui/notice";
import { Switch } from "@/components/ui/switch";
import {
  Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Bell, Loader2, Megaphone, Plus, Save, Trash2 } from "lucide-react";
import { berlinHour, berlinYmd } from "@/lib/berlin-day";
import { offerAnnounceBlock, offerPushText } from "@/lib/rider-announce-rules";
import { PushAnnounceField, type PushReach } from "./push-announce-field";
import { AudienceField, audienceBadgeText } from "./audience-field";
import type { PassAudience } from "@/lib/rider-pass";

export interface OfferAdminRow {
  id: number;
  title: string;
  text: string | null;
  /** "YYYY-MM-DD" oder null */
  validFrom: string | null;
  validTo: string | null;
  active: boolean;
  /** Heute in der App sichtbar. */
  visible: boolean;
  pushPlanned: boolean;
  /** ISO-Zeit des Push-Versands oder null. */
  pushedAt: string | null;
  pushSent: number | null;
  audience: PassAudience;
}

interface FormState {
  id: number | null;
  title: string;
  text: string;
  validFrom: string;
  validTo: string;
  active: boolean;
  push: boolean;
  audience: PassAudience;
}

/** Neue Angebote melden wir standardmäßig per Push; abschalten geht im Dialog. */
const EMPTY: FormState = { id: null, title: "", text: "", validFrom: "", validTo: "", active: true, push: true, audience: "RIDE" };

function fmt(ymd: string | null): string {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-");
  return `${d}.${m}.${y}`;
}

function rangeText(o: { validFrom: string | null; validTo: string | null }): string {
  if (o.validFrom && o.validTo) return `${fmt(o.validFrom)} bis ${fmt(o.validTo)}`;
  if (o.validFrom) return `ab ${fmt(o.validFrom)}`;
  if (o.validTo) return `bis ${fmt(o.validTo)}`;
  return "ohne Ende";
}

/** Angebote, die Abo-Fahrer auf der Startseite der Kunden-App sehen. */
export function OffersCard({
  offers,
  reach,
  beachEnabled = false,
}: {
  offers: OfferAdminRow[];
  reach: PushReach;
  /** Beach Pass an: Feld „Für“ zeigen. */
  beachEnabled?: boolean;
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
  const selected = form?.id != null ? offers.find((o) => o.id === form.id) : undefined;
  const valid =
    !!form &&
    form.title.trim().length > 0 &&
    (!form.validFrom || !form.validTo || form.validFrom <= form.validTo);

  async function send(method: "POST" | "PATCH" | "DELETE") {
    if (!form) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(
        form.id == null ? "/api/gamification/offers" : `/api/gamification/offers/${form.id}`,
        method === "DELETE"
          ? { method }
          : {
              method,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                title: form.title.trim(),
                text: form.text.trim() || null,
                validFrom: form.validFrom || null,
                validTo: form.validTo || null,
                active: form.active,
                push: form.push,
                ...(beachEnabled && { audience: form.audience }),
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

  return (
    <>
      <Card flush>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Megaphone className="h-4 w-4 text-primary shrink-0" />
            Angebote ({offers.length})
          </CardTitle>
          <CardDescription>
            Oben auf der Startseite der App, höchstens drei zugleich.
          </CardDescription>
          <CardAction>
            <Button onClick={() => open(EMPTY)} className="max-sm:h-11" aria-label="Angebot anlegen">
              <Plus className="h-4 w-4" />
              <span>Angebot<span className="max-sm:sr-only"> anlegen</span></span>
            </Button>
          </CardAction>
        </CardHeader>
        <Table edge>
          <TableHeader>
            <TableRow>
              <TableHead>Angebot</TableHead>
              <TableHead className="hidden sm:table-cell">Sichtbar</TableHead>
              <TableHead className="text-right">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {offers.length === 0 && (
              <TableEmpty
                colSpan={3}
                icon={Megaphone}
                title="Noch keine Angebote"
                description="Zum Beispiel „Feierabend-Stunde: ab 18 Uhr Leihbrett gratis“."
                compact={false}
              />
            )}
            {offers.map((o) => (
              <TableRow
                key={o.id}
                className="cursor-pointer max-sm:h-11"
                onClick={() => open({ id: o.id, title: o.title, text: o.text ?? "", validFrom: o.validFrom ?? "", validTo: o.validTo ?? "", active: o.active, push: o.pushPlanned, audience: o.audience })}
              >
                <TableCell className="whitespace-normal">
                  <span className="font-medium text-foreground">{o.title}</span>
                  {o.pushedAt && <Bell className="ml-1.5 inline h-3.5 w-3.5 text-muted-foreground" aria-label="Push gesendet" />}
                  {beachEnabled && audienceBadgeText(o.audience) && (
                    <Badge variant="neutral" className="ml-1.5 font-normal">{audienceBadgeText(o.audience)}</Badge>
                  )}
                  {o.text && <div className="text-xs text-muted-foreground">{o.text}</div>}
                  <div className="text-xs text-muted-foreground sm:hidden">{rangeText(o)}</div>
                </TableCell>
                <TableCell className="hidden sm:table-cell">{rangeText(o)}</TableCell>
                <TableCell className="text-right">
                  <Badge variant={o.visible ? "success" : "neutral"} className="font-normal">
                    {o.visible ? "sichtbar" : o.active ? "nicht im Zeitraum" : "aus"}
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
            <DialogTitle>{form?.id == null ? "Angebot anlegen" : "Angebot bearbeiten"}</DialogTitle>
            <DialogDescription>Kurz und konkret: ein Titel und ein Satz dazu.</DialogDescription>
          </DialogHeader>
          {form && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="of-title">Titel</Label>
                <Input id="of-title" value={form.title} maxLength={60} onChange={(e) => set({ title: e.target.value })} className="max-sm:h-11" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="of-text">Text (optional)</Label>
                <Input id="of-text" value={form.text} maxLength={300} onChange={(e) => set({ text: e.target.value })} className="max-sm:h-11" />
              </div>
              <div className="grid gap-4 grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="of-from">Sichtbar ab</Label>
                  <Input id="of-from" type="date" value={form.validFrom} onChange={(e) => set({ validFrom: e.target.value })} className="max-sm:h-11" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="of-to">Sichtbar bis</Label>
                  <Input id="of-to" type="date" value={form.validTo} min={form.validFrom || undefined} onChange={(e) => set({ validTo: e.target.value })} className="max-sm:h-11" />
                </div>
              </div>
              {beachEnabled && <AudienceField id="of-audience" value={form.audience} onChange={(v) => set({ audience: v })} />}
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="of-active">Aktiv</Label>
                <Switch id="of-active" checked={form.active} onCheckedChange={(v) => set({ active: v })} />
              </div>

              <PushAnnounceField
                id="of-push"
                checked={form.push}
                onChange={(v) => set({ push: v })}
                preview={offerPushText({ title: form.title.trim() || "Titel", text: form.text, toYmd: form.validTo || null })}
                reach={reach}
                status={selected ? { pushedAt: selected.pushedAt, pushSent: selected.pushSent } : null}
                block={offerAnnounceBlock(
                  { title: form.title, active: form.active, fromYmd: form.validFrom || null, toYmd: form.validTo || null, pushPlanned: form.push, pushedAt: null },
                  berlinYmd(new Date()),
                  berlinHour(new Date()),
                )}
              />

              {error && <Notice tone="danger" compact title={error} />}
              {confirmDelete && (
                <Notice
                  tone="danger"
                  compact
                  title={`„${form.title}“ wirklich löschen?`}
                  action={
                    <Button type="button" variant="destructive" size="sm" onClick={() => send("DELETE")} disabled={saving} className="max-sm:h-11">
                      <Trash2 className="h-3.5 w-3.5" />
                      Endgültig löschen
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
