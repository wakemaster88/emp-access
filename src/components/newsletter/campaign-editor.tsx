"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown, ArrowUp, Copy, Eye, Heading, Image as ImageIcon, Loader2, Minus, MousePointerClick,
  Plus, Save, Send, Trash2, Type, Upload, X, type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { Segmented } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import { ToggleChip, ToggleChipGroup } from "@/components/ui/toggle-chip";
import {
  BLOCK_LABEL, BLOCK_TYPES, forceColorScheme, isHttpsUrl, isLinkUrl, parseBlocks, renderNewsletterHtml,
  type NewsletterBlock, type NewsletterBlockType, type NewsletterBrand,
} from "@/lib/newsletter/blocks";

const BLOCK_ICON: Record<NewsletterBlockType, LucideIcon> = {
  heading: Heading,
  text: Type,
  image: ImageIcon,
  button: MousePointerClick,
  divider: Minus,
};

/** Baustein im Editor: alle Felder als Text, damit halbe Eingaben stehen bleiben. */
interface EditBlock {
  key: number;
  type: NewsletterBlockType;
  text: string;
  url: string;
  alt: string;
  link: string;
  label: string;
}

let nextKey = 1;

function toEdit(b: NewsletterBlock): EditBlock {
  const base = { key: nextKey++, type: b.type, text: "", url: "", alt: "", link: "", label: "" };
  switch (b.type) {
    case "heading":
    case "text":
      return { ...base, text: b.text };
    case "image":
      return { ...base, url: b.url, alt: b.alt ?? "", link: b.link ?? "" };
    case "button":
      return { ...base, label: b.label, url: b.url };
    default:
      return base;
  }
}

function fromEdit(b: EditBlock): Record<string, string> {
  switch (b.type) {
    case "heading":
    case "text":
      return { type: b.type, text: b.text };
    case "image":
      return { type: "image", url: b.url.trim(), alt: b.alt, link: b.link.trim() };
    case "button":
      return { type: "button", label: b.label, url: b.url.trim() };
    default:
      return { type: "divider" };
  }
}

/** Für die Vorschau: unfertige Bausteine weglassen statt Fehler zeigen. */
function previewBlock(b: EditBlock): NewsletterBlock | null {
  switch (b.type) {
    case "heading":
    case "text":
      return b.text.trim() ? { type: b.type, text: b.text.trim() } : null;
    case "image":
      return isHttpsUrl(b.url.trim())
        ? { type: "image", url: b.url.trim(), alt: b.alt, ...(isLinkUrl(b.link.trim()) ? { link: b.link.trim() } : {}) }
        : null;
    case "button":
      return b.label.trim() ? { type: "button", label: b.label.trim(), url: isLinkUrl(b.url.trim()) ? b.url.trim() : "#" } : null;
    default:
      return { type: "divider" };
  }
}

export interface EditorCampaign {
  id: number;
  subject: string;
  preheader: string;
  blocks: NewsletterBlock[];
  /** Empfänger-Gruppen; leer: alle angemeldeten. */
  groupIds: number[];
}

export interface EditorGroup {
  id: number;
  name: string;
  /** Angemeldete Mitglieder. */
  active: number;
}

const sortIds = (ids: number[]) => [...ids].sort((a, b) => a - b);
const snapshot = (p: { subject: string; preheader: string; blocks: unknown; groupIds: number[] }) =>
  JSON.stringify({ s: p.subject, p: p.preheader, b: p.blocks, g: sortIds(p.groupIds) });

/** Entwurf bearbeiten: Bausteine links, Vorschau rechts, Testmail und Senden. */
export function CampaignEditor({
  campaign,
  brand,
  reason,
  groups,
  recipientCount,
  canSend,
  canTest,
  testTo,
}: {
  campaign: EditorCampaign;
  brand: NewsletterBrand;
  reason: string;
  groups: EditorGroup[];
  /** Angemeldete Empfänger der gespeicherten Auswahl. */
  recipientCount: number;
  /** Alles bereit für den Versand an alle. */
  canSend: boolean;
  /** Zugangsdaten und Absender da: Testmails gehen. */
  canTest: boolean;
  testTo: string;
}) {
  const router = useRouter();
  const [subject, setSubject] = useState(campaign.subject);
  const [preheader, setPreheader] = useState(campaign.preheader);
  const [blocks, setBlocks] = useState<EditBlock[]>(() => campaign.blocks.map(toEdit));
  const [groupIds, setGroupIds] = useState<number[]>(() => campaign.groupIds.filter((id) => groups.some((g) => g.id === id)));
  const [activeCount, setActiveCount] = useState(recipientCount);
  const [counting, setCounting] = useState(false);
  const [savedJson, setSavedJson] = useState(() =>
    snapshot({ subject: campaign.subject, preheader: campaign.preheader, blocks: campaign.blocks.map(toEdit).map(fromEdit), groupIds: campaign.groupIds }),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [testOpen, setTestOpen] = useState(false);
  const [testAddress, setTestAddress] = useState(testTo);
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: string[]; failed: Array<{ to: string; error: string }> } | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const payload = { subject: subject.trim(), preheader: preheader.trim(), blocks: blocks.map(fromEdit), groupIds: sortIds(groupIds) };
  const dirty = snapshot(payload) !== savedJson;
  const check = parseBlocks(payload.blocks);
  const problem = !payload.subject ? "Betreff fehlt" : "error" in check ? check.error : null;
  const groupKey = payload.groupIds.join(",");
  const audience = groupIds.length
    ? groups.filter((g) => groupIds.includes(g.id)).map((g) => g.name).join(", ")
    : "alle angemeldeten Abonnenten";

  // Empfänger der Auswahl zählen (eine Adresse in zwei Gruppen zählt einmal).
  useEffect(() => {
    let stop = false;
    const t = setTimeout(async () => {
      setCounting(true);
      try {
        const res = await fetch(`/api/newsletter/recipients?groups=${groupKey}`);
        const json = await res.json().catch(() => ({}));
        if (!stop && res.ok && typeof json.count === "number") setActiveCount(json.count);
      } catch {
        // Zahl bleibt stehen; der Versand zählt selbst noch einmal.
      } finally {
        if (!stop) setCounting(false);
      }
    }, 250);
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [groupKey]);

  const toggleGroup = (id: number, on: boolean) =>
    setGroupIds((list) => (on ? [...list.filter((x) => x !== id), id] : list.filter((x) => x !== id)));

  const html = useMemo(
    () =>
      renderNewsletterHtml(blocks.map(previewBlock).filter((b): b is NewsletterBlock => !!b), {
        brand,
        preheader,
        unsubscribeUrl: "#",
        reason,
      }),
    [blocks, brand, preheader, reason],
  );

  const update = (key: number, patch: Partial<EditBlock>) =>
    setBlocks((list) => list.map((b) => (b.key === key ? { ...b, ...patch } : b)));
  const move = (index: number, dir: -1 | 1) =>
    setBlocks((list) => {
      const next = [...list];
      const [b] = next.splice(index, 1);
      next.splice(index + dir, 0, b);
      return next;
    });
  const add = (type: NewsletterBlockType) =>
    setBlocks((list) => [...list, { key: nextKey++, type, text: "", url: "", alt: "", link: "", label: "" }]);

  /** Speichert, wenn nötig. Wirft mit Meldung, wenn es nicht klappt. */
  async function persist(): Promise<void> {
    if (problem) throw new Error(problem);
    if (!dirty) return;
    const res = await fetch(`/api/newsletter/campaigns/${campaign.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error(typeof json.error === "string" ? json.error : "Speichern fehlgeschlagen");
    }
    setSavedJson(snapshot(payload));
  }

  async function save() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await persist();
      setNotice("Gespeichert.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Speichern fehlgeschlagen");
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setTestBusy(true);
    setTestResult(null);
    setError("");
    try {
      await persist();
      const res = await fetch(`/api/newsletter/campaigns/${campaign.id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: testAddress }),
      });
      const json = await res.json().catch(() => ({}));
      if (Array.isArray(json.sent)) {
        setTestResult({ ok: json.sent, failed: Array.isArray(json.failed) ? json.failed : [] });
      } else {
        setTestResult({ ok: [], failed: [{ to: testAddress, error: typeof json.error === "string" ? json.error : "Senden fehlgeschlagen" }] });
      }
    } catch (err) {
      setTestResult({ ok: [], failed: [{ to: testAddress, error: err instanceof Error ? err.message : "Netzwerkfehler" }] });
    } finally {
      setTestBusy(false);
    }
  }

  async function sendAll() {
    await persist();
    const res = await fetch(`/api/newsletter/campaigns/${campaign.id}/send`, { method: "POST" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Starten fehlgeschlagen");
    router.refresh();
  }

  async function remove() {
    const res = await fetch(`/api/newsletter/campaigns/${campaign.id}`, { method: "DELETE" });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error(typeof json.error === "string" ? json.error : "Löschen fehlgeschlagen");
    }
    router.push("/newsletter?tab=aussendungen");
    router.refresh();
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Entwurf</CardTitle>
          <CardDescription>
            Geht an {activeCount.toLocaleString("de-DE")} angemeldete Abonnenten ({audience}). Schick ihn dir vorher als Testmail.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {groups.length > 0 && (
            <div className="space-y-1.5">
              <p id="nl-audience" className="text-label">Empfänger</p>
              <ToggleChipGroup aria-labelledby="nl-audience">
                <ToggleChip pressed={groupIds.length === 0} onPressedChange={() => setGroupIds([])}>
                  Alle angemeldeten
                </ToggleChip>
                {groups.map((g) => (
                  <ToggleChip key={g.id} pressed={groupIds.includes(g.id)} onPressedChange={(on) => toggleGroup(g.id, on)}>
                    {g.name}
                    <span className="tabular-nums opacity-70">{g.active.toLocaleString("de-DE")}</span>
                  </ToggleChip>
                ))}
              </ToggleChipGroup>
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {counting ? "Zähle …" : `${activeCount.toLocaleString("de-DE")} Empfänger. Wer in mehreren gewählten Gruppen ist, bekommt die Mail einmal.`}
              </p>
            </div>
          )}
          {error && <Notice tone="danger" compact title={error} />}
          {notice && !dirty && !error && <Notice tone="success" compact title={notice} />}
          {problem && !error && <Notice tone="warning" compact title={problem} />}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDeleteOpen(true)}
              className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive max-sm:h-11 sm:mr-auto"
            >
              <Trash2 className="h-4 w-4" />
              Löschen
            </Button>
            <Button type="button" variant="outline" onClick={save} disabled={saving || !dirty || !!problem} className="max-sm:h-11">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Speichern
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setTestResult(null);
                setTestOpen(true);
              }}
              disabled={!canTest || !!problem}
              title={canTest ? undefined : "Erst Zugangsdaten und Absender eintragen"}
              className="max-sm:h-11"
            >
              <Eye className="h-4 w-4" />
              Testmail
            </Button>
            <Button
              type="button"
              onClick={() => setSendOpen(true)}
              disabled={!canSend || !!problem || activeCount === 0 || counting}
              title={canSend ? undefined : "Erst den Versand in den Einstellungen bereit machen"}
              className="max-sm:h-11"
            >
              <Send className="h-4 w-4" />
              An {activeCount.toLocaleString("de-DE")} senden
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2 lg:items-start">
        <Card>
          <CardHeader>
            <CardTitle>Inhalt</CardTitle>
            <CardDescription>Im Text: **fett** und [Linktext](https://…). Leerzeile = neuer Absatz.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="nl-subject">Betreff</Label>
              <Input id="nl-subject" value={subject} maxLength={150} onChange={(e) => setSubject(e.target.value)} className="max-sm:h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nl-preheader">Vorschauzeile (optional)</Label>
              <Input
                id="nl-preheader"
                value={preheader}
                maxLength={200}
                placeholder="Steht im Postfach hinter dem Betreff"
                onChange={(e) => setPreheader(e.target.value)}
                className="max-sm:h-11"
              />
            </div>

            <div className="space-y-2">
              {blocks.map((b, i) => {
                const Icon = BLOCK_ICON[b.type];
                const id = `nl-b${b.key}`;
                return (
                  <div key={b.key} className="glass-tile space-y-2 p-3">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1 text-[13px] font-medium">
                        {BLOCK_LABEL[b.type]} {i + 1}
                      </span>
                      <Button type="button" variant="ghost" size="icon" aria-label={`${BLOCK_LABEL[b.type]} ${i + 1} nach oben`} disabled={i === 0} onClick={() => move(i, -1)}>
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" aria-label={`${BLOCK_LABEL[b.type]} ${i + 1} nach unten`} disabled={i === blocks.length - 1} onClick={() => move(i, 1)}>
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`${BLOCK_LABEL[b.type]} ${i + 1} entfernen`}
                        onClick={() => setBlocks((list) => list.filter((x) => x.key !== b.key))}
                        className="hover:bg-destructive/10 hover:text-destructive"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    {b.type === "heading" && (
                      <Input aria-label={`Überschrift ${i + 1}`} value={b.text} maxLength={200} onChange={(e) => update(b.key, { text: e.target.value })} className="max-sm:h-11" />
                    )}
                    {b.type === "text" && (
                      <Textarea aria-label={`Text ${i + 1}`} value={b.text} maxLength={5000} rows={5} onChange={(e) => update(b.key, { text: e.target.value })} />
                    )}
                    {b.type === "image" && (
                      <div className="space-y-2">
                        <div className="space-y-1">
                          <Label htmlFor={`${id}-url`} className="text-xs">Bild-Adresse (https)</Label>
                          <ImageUrlField id={`${id}-url`} index={i + 1} value={b.url} onChange={(url) => update(b.key, { url })} />
                        </div>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <div className="space-y-1">
                            <Label htmlFor={`${id}-alt`} className="text-xs">Beschreibung</Label>
                            <Input id={`${id}-alt`} value={b.alt} maxLength={200} onChange={(e) => update(b.key, { alt: e.target.value })} className="max-sm:h-11" />
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor={`${id}-link`} className="text-xs">Link beim Antippen (optional)</Label>
                            <Input id={`${id}-link`} value={b.link} spellCheck={false} onChange={(e) => update(b.key, { link: e.target.value })} className="max-sm:h-11" />
                          </div>
                        </div>
                      </div>
                    )}
                    {b.type === "button" && (
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <div className="space-y-1">
                          <Label htmlFor={`${id}-label`} className="text-xs">Beschriftung</Label>
                          <Input id={`${id}-label`} value={b.label} maxLength={60} onChange={(e) => update(b.key, { label: e.target.value })} className="max-sm:h-11" />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`${id}-url`} className="text-xs">Ziel (https)</Label>
                          <Input id={`${id}-url`} value={b.url} spellCheck={false} onChange={(e) => update(b.key, { url: e.target.value })} className="max-sm:h-11" />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="space-y-1.5">
              <p className="text-label">Baustein hinzufügen</p>
              <div className="flex flex-wrap gap-2">
                {BLOCK_TYPES.map((t) => {
                  const Icon = BLOCK_ICON[t];
                  return (
                    <Button key={t} type="button" variant="outline" size="sm" onClick={() => add(t)} disabled={blocks.length >= 40} className="max-sm:h-11">
                      <Plus className="h-3.5 w-3.5" />
                      <Icon className="h-3.5 w-3.5" />
                      {BLOCK_LABEL[t]}
                    </Button>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        <PreviewCard html={html} subject={subject} preheader={preheader} />
      </div>

      <Dialog open={testOpen} onOpenChange={(o) => !testBusy && setTestOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Testmail senden</DialogTitle>
            <DialogDescription>
              Mit „[Test]“ vor dem Betreff. Bis zu fünf Adressen, mit Komma getrennt. Im SES-Sandkasten nur an bestätigte Adressen.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void sendTest();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="nl-test-to">An</Label>
              <Input id="nl-test-to" value={testAddress} onChange={(e) => setTestAddress(e.target.value)} spellCheck={false} className="max-sm:h-11" />
            </div>
            {testResult?.ok.length ? <Notice tone="success" compact title={`Gesendet an ${testResult.ok.join(", ")}`} /> : null}
            {testResult?.failed.map((f) => (
              <Notice key={f.to} tone="danger" compact title={f.to}>
                {f.error}
              </Notice>
            ))}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setTestOpen(false)} disabled={testBusy} className="max-sm:h-11">
                Schließen
              </Button>
              <Button type="submit" disabled={testBusy || !testAddress.trim()} className="min-w-24 max-sm:h-11">
                {testBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Send className="h-4 w-4" />Senden</>}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={sendOpen}
        onOpenChange={setSendOpen}
        title={`„${subject.trim()}“ an ${activeCount.toLocaleString("de-DE")} Abonnenten senden?`}
        description={`An ${audience}. Der Versand startet innerhalb einer Minute und läuft in Raten. Anhalten geht, schon verschickte Mails bleiben verschickt.`}
        confirmLabel="Jetzt senden"
        destructive={false}
        onConfirm={sendAll}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Entwurf löschen?"
        description="Der Entwurf ist danach weg."
        onConfirm={remove}
      />
    </>
  );
}

/**
 * Mail-Vorschau in einem abgeschotteten Rahmen (keine Skripte, keine Links).
 * „Handy“ zeigt sie 375 px breit, so greift die Handy-Ansicht der Mail;
 * „Dunkel“ zeigt die dunkle Ansicht, unabhängig von der des Geräts.
 */
export function PreviewCard({ html, subject, preheader }: { html: string; subject: string; preheader: string }) {
  const [view, setView] = useState<"computer" | "handy">("computer");
  const [scheme, setScheme] = useState<"light" | "dark">("light");
  const shown = useMemo(() => forceColorScheme(html, scheme), [html, scheme]);
  return (
    <Card className="lg:sticky lg:top-20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Eye className="h-4 w-4 shrink-0 text-primary" />
          Vorschau
        </CardTitle>
        <CardDescription className="break-words">
          <span className="font-medium text-foreground">{subject.trim() || "Ohne Betreff"}</span>
          {preheader.trim() && <> · {preheader.trim()}</>}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex flex-wrap gap-2">
          <Segmented
            aria-label="Gerät der Vorschau"
            size="sm"
            value={view}
            onValueChange={setView}
            options={[
              { value: "computer", label: "Computer" },
              { value: "handy", label: "Handy" },
            ]}
          />
          <Segmented
            aria-label="Hell oder dunkel"
            size="sm"
            value={scheme}
            onValueChange={setScheme}
            options={[
              { value: "light", label: "Hell" },
              { value: "dark", label: "Dunkel" },
            ]}
          />
        </div>
        <iframe
          title={`Vorschau der Mail${view === "handy" ? " auf dem Handy" : ""}${scheme === "dark" ? ", dunkel" : ""}`}
          srcDoc={shown}
          sandbox=""
          className={
            view === "handy"
              ? "mx-auto block h-[70vh] min-h-[480px] w-full max-w-[375px] rounded-tile border border-border"
              : "h-[70vh] min-h-[480px] w-full rounded-tile border border-border"
          }
        />
      </CardContent>
    </Card>
  );
}

/** Formate, die der Server selbst lesen kann; alles andere wandelt der Browser vorher in JPEG. */
const SERVER_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"]);
const UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

/**
 * Große Fotos oder Formate wie HEIC im Browser auf höchstens 2400 px
 * verkleinern und als JPEG schicken. Der Server kodiert danach ohnehin neu.
 */
async function uploadBody(file: File): Promise<Blob> {
  if (SERVER_IMAGE_TYPES.has(file.type) && file.size <= UPLOAD_MAX_BYTES) return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Dieses Bildformat kann der Browser nicht lesen. Bitte als JPEG oder PNG speichern.");
  }
  const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Das Bild ließ sich nicht verkleinern");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
  if (!blob) throw new Error("Das Bild ließ sich nicht verkleinern");
  if (blob.size > UPLOAD_MAX_BYTES) throw new Error("Das Bild ist auch verkleinert größer als 4 MB");
  return blob;
}

/**
 * Adresse eines Bildes, eingetippt oder hochgeladen. Der Server speichert
 * hochgeladene Bilder als JPEG (oder PNG mit Transparenz) und liefert die Adresse.
 */
function ImageUrlField({ id, index, value, onChange }: { id: string; index: number; value: string; onChange: (url: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const upload = async (file: File) => {
    setBusy(true);
    setError("");
    try {
      const body = await uploadBody(file);
      const res = await fetch("/api/newsletter/images", {
        method: "POST",
        headers: { "Content-Type": body.type || "application/octet-stream" },
        body,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || typeof json.url !== "string") {
        throw new Error(typeof json.error === "string" ? json.error : "Hochladen fehlgeschlagen");
      }
      onChange(json.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Hochladen fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input id={id} value={value} placeholder="https://…/bild.jpg" spellCheck={false} onChange={(e) => onChange(e.target.value)} className="max-sm:h-11 sm:flex-1" />
        <input
          ref={input}
          type="file"
          accept="image/*"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void upload(file);
          }}
        />
        <Button type="button" variant="outline" aria-label={`Bild ${index} hochladen`} disabled={busy} onClick={() => input.current?.click()} className="max-sm:h-11 sm:shrink-0">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {busy ? "Lädt hoch…" : "Hochladen"}
        </Button>
      </div>
      {error && <Notice tone="danger" compact title={error} />}
    </div>
  );
}

/** Kopie einer Aussendung als neuer Entwurf. */
export function CopyCampaignButton({ campaign }: { campaign: EditorCampaign }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        className="max-sm:h-11 max-sm:w-full"
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const res = await fetch("/api/newsletter/campaigns", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                subject: campaign.subject,
                preheader: campaign.preheader,
                blocks: campaign.blocks,
                groupIds: campaign.groupIds,
              }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok || typeof json.id !== "number") throw new Error(typeof json.error === "string" ? json.error : "Kopieren fehlgeschlagen");
            router.push(`/newsletter/${json.id}`);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Kopieren fehlgeschlagen");
            setBusy(false);
          }
        }}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
        Als neuen Entwurf kopieren
      </Button>
      {error && <Notice tone="danger" compact title={error} />}
    </div>
  );
}
