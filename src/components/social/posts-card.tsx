"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check, Copy, CopyPlus, Film, ImagePlus, Link2, Loader2, Plus, Share2, Trash2, X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmStep } from "@/components/ui/confirm-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { IconChip } from "@/components/ui/icon-chip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Notice } from "@/components/ui/notice";
import { Segmented } from "@/components/ui/segmented";
import { Textarea } from "@/components/ui/textarea";
import type { SocialPostRow } from "@/lib/social/load";
import {
  CHANNEL_LABEL, CHANNEL_TEXT_LIMIT, FORMAT_LABEL, POST_STATUSES, POST_STATUS_LABEL, SOCIAL_CHANNELS, SOCIAL_FORMATS,
  isHttpsUrl, postCopyText, toBerlinLocalInput,
  type PostStatus, type SocialChannel, type SocialFormat,
} from "@/lib/social/rules";
import { socialLink } from "@/lib/social/utm";
import { CHANNEL_ICON, excerpt, nf, postBadge, whenLabel } from "./social-ui";
import { canShareFiles, copyText, sharePost } from "./share";

export interface PostsCampaign {
  id: number;
  slug: string;
  landingUrl: string | null;
  hashtags: string | null;
}

interface EditPost {
  id: number | null;
  channel: SocialChannel;
  format: SocialFormat;
  status: PostStatus;
  text: string;
  media: string[];
  link: string;
  plannedAt: string;
  postUrl: string;
  reach: string;
  interactions: string;
  clicks: string;
  notes: string;
}

const UPLOAD_MAX_BYTES = 4 * 1024 * 1024;
const SERVER_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"]);

function toEdit(p: SocialPostRow): EditPost {
  return {
    id: p.id,
    channel: p.channel,
    format: p.format,
    status: p.status,
    text: p.text,
    media: [...p.media],
    link: p.link ?? "",
    plannedAt: toBerlinLocalInput(p.plannedAt ? new Date(p.plannedAt) : null),
    postUrl: p.postUrl ?? "",
    reach: p.reach?.toString() ?? "",
    interactions: p.interactions?.toString() ?? "",
    clicks: p.clicks?.toString() ?? "",
    notes: p.notes ?? "",
  };
}

function emptyPost(channel: SocialChannel = "INSTAGRAM"): EditPost {
  return {
    id: null, channel, format: "POST", status: "IDEA", text: "", media: [], link: "", plannedAt: "",
    postUrl: "", reach: "", interactions: "", clicks: "", notes: "",
  };
}

function isVideo(url: string): boolean {
  return /\.(mp4|mov|m4v|webm)(\?|$)/i.test(url);
}

/** Große Dateien und Formate wie HEIC im Browser auf JPEG verkleinern. */
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
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) throw new Error("Das Bild ließ sich nicht verkleinern");
  if (blob.size > UPLOAD_MAX_BYTES) throw new Error("Das Bild ist auch verkleinert größer als 4 MB");
  return blob;
}

/** Taste „Kopieren“, die kurz „Kopiert“ zeigt. */
function CopyButton({ text, label = "Text kopieren", iconOnly = false }: { text: string; label?: string; iconOnly?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      variant={iconOnly ? "ghost" : "outline"}
      size={iconOnly ? "icon" : "default"}
      className={iconOnly ? "size-11 shrink-0 sm:size-9" : "max-sm:h-11"}
      aria-label={iconOnly ? label : undefined}
      title={iconOnly ? label : undefined}
      onClick={(e) => {
        e.stopPropagation();
        void copyText(text).then((ok) => {
          if (!ok) return;
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        });
      }}
    >
      {done ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
      {!iconOnly && <span>{done ? "Kopiert" : label}</span>}
    </Button>
  );
}

/** Beiträge der Kampagne nach Termin; ein Klick öffnet den Beitrag. */
export function PostsCard({
  campaign,
  posts,
  openPostId,
}: {
  campaign: PostsCampaign;
  posts: SocialPostRow[];
  openPostId: number | null;
}) {
  const router = useRouter();
  const [edit, setEdit] = useState<EditPost | null>(() => {
    const p = openPostId ? posts.find((x) => x.id === openPostId) : null;
    return p ? toEdit(p) : null;
  });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newMedia, setNewMedia] = useState("");
  // Nur im Browser prüfbar; beim Öffnen eines Beitrags neu gesetzt.
  const [canShare, setCanShare] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const open = (p: EditPost) => {
    setCanShare(canShareFiles());
    setEdit(p);
    setError("");
    setConfirmDelete(false);
    setNewMedia("");
  };
  const close = () => {
    if (busy || uploading) return;
    setEdit(null);
    // Der Beitrag aus dem Link (?beitrag=…) soll nach dem Schließen nicht wieder aufgehen.
    if (openPostId) router.replace(`/newsletter/social/${campaign.id}`, { scroll: false });
  };
  const set = (patch: Partial<EditPost>) => setEdit((e) => (e ? { ...e, ...patch } : e));

  async function save() {
    if (!edit) return;
    setBusy(true);
    setError("");
    try {
      const body = {
        channel: edit.channel,
        format: edit.format,
        status: edit.status,
        text: edit.text,
        media: edit.media,
        link: edit.link.trim(),
        plannedAt: edit.plannedAt || null,
        postUrl: edit.postUrl.trim(),
        reach: edit.reach.trim() || null,
        interactions: edit.interactions.trim() || null,
        clicks: edit.clicks.trim() || null,
        notes: edit.notes,
      };
      const res = await fetch(edit.id ? `/api/social/posts/${edit.id}` : `/api/social/campaigns/${campaign.id}/posts`, {
        method: edit.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : "Speichern fehlgeschlagen");
        return;
      }
      setEdit(null);
      if (openPostId) router.replace(`/newsletter/social/${campaign.id}`, { scroll: false });
      router.refresh();
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!edit?.id) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/social/posts/${edit.id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : "Löschen fehlgeschlagen");
        setConfirmDelete(false);
        return;
      }
      setEdit(null);
      router.refresh();
    } catch {
      setError("Netzwerkfehler");
    } finally {
      setBusy(false);
    }
  }

  async function upload(files: FileList) {
    setUploading(true);
    setError("");
    try {
      for (const file of Array.from(files).slice(0, 10)) {
        const body = await uploadBody(file);
        const res = await fetch("/api/social/media", {
          method: "POST",
          headers: { "Content-Type": body.type || "application/octet-stream" },
          body,
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || typeof json.url !== "string") throw new Error(typeof json.error === "string" ? json.error : "Hochladen fehlgeschlagen");
        setEdit((e) => (e ? { ...e, media: [...e.media, json.url].slice(0, 10) } : e));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Hochladen fehlgeschlagen");
    } finally {
      setUploading(false);
    }
  }

  const limit = edit ? CHANNEL_TEXT_LIMIT[edit.channel] : 0;
  const copy = edit ? postCopyText(edit.text, campaign.hashtags) : "";
  const campaignUrl = edit && campaign.landingUrl ? socialLink(campaign.landingUrl, campaign.slug, edit.channel) : null;
  const published = posts.filter((p) => p.status === "PUBLISHED").length;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Beiträge ({posts.length})</CardTitle>
          <CardDescription>
            {posts.length ? `${published} von ${posts.length} gepostet. ` : ""}Text kopieren, im Kanal posten, dann auf „Veröffentlicht“ stellen.
          </CardDescription>
          <CardAction>
            <Button onClick={() => open(emptyPost(posts.at(-1)?.channel))} className="max-sm:h-11" aria-label="Beitrag anlegen">
              <Plus className="h-4 w-4" />
              <span>Beitrag<span className="max-sm:sr-only"> anlegen</span></span>
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {posts.length === 0 ? (
            <EmptyState
              icon={ImagePlus}
              size="sm"
              title="Noch kein Beitrag"
              description="Leg einen Beitrag je Kanal an: Text, Bilder und Termin."
            />
          ) : (
            <ul className="space-y-2">
              {posts.map((p) => (
                <li key={p.id} className="glass-tile flex items-center gap-1 pr-1">
                  <button
                    type="button"
                    onClick={() => open(toEdit(p))}
                    className="press flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-[inherit] px-3 py-2.5 text-left"
                  >
                    <IconChip icon={CHANNEL_ICON[p.channel]} tone="primary" label={CHANNEL_LABEL[p.channel]} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-foreground">
                        {excerpt(p.text) || `${FORMAT_LABEL[p.format]} auf ${CHANNEL_LABEL[p.channel]}`}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        <span className="sm:hidden">{p.overdue ? "Überfällig" : POST_STATUS_LABEL[p.status]} · </span>
                        <span className="max-sm:hidden">{CHANNEL_LABEL[p.channel]} · </span>
                        {FORMAT_LABEL[p.format]} ·{" "}
                        {p.status === "PUBLISHED"
                          ? `gepostet ${whenLabel(p.publishedAt) ?? ""}${p.reach !== null ? ` · ${nf.format(p.reach)} erreicht` : ""}`
                          : (whenLabel(p.plannedAt) ?? "ohne Termin")}
                        {p.media.length ? ` · ${p.media.length} ${p.media.length === 1 ? "Bild" : "Bilder"}` : ""}
                      </span>
                    </span>
                    <Badge variant={postBadge(p.status, p.overdue)} className="shrink-0 font-normal max-sm:hidden">
                      {p.overdue ? "Überfällig" : POST_STATUS_LABEL[p.status]}
                    </Badge>
                  </button>
                  {p.text.trim() && <CopyButton text={postCopyText(p.text, campaign.hashtags)} iconOnly />}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!edit} onOpenChange={(o) => !o && close()}>
        <DialogContent className="sm:max-w-2xl">
          {edit && (
            <>
              <DialogHeader>
                <DialogTitle>{edit.id ? "Beitrag bearbeiten" : "Beitrag anlegen"}</DialogTitle>
                <DialogDescription>
                  Gepostet wird von Hand im Kanal. Hier stehen Text, Bilder, Termin und danach die Zahlen.
                </DialogDescription>
              </DialogHeader>

              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void save();
                }}
              >
                <div className="grid grid-cols-2 gap-3">
                  <div className="min-w-0 space-y-1.5">
                    <Label htmlFor="sp-channel">Kanal</Label>
                    <NativeSelect id="sp-channel" value={edit.channel} onChange={(e) => set({ channel: e.target.value as SocialChannel })}>
                      {SOCIAL_CHANNELS.map((c) => (
                        <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="min-w-0 space-y-1.5">
                    <Label htmlFor="sp-format">Format</Label>
                    <NativeSelect id="sp-format" value={edit.format} onChange={(e) => set({ format: e.target.value as SocialFormat })}>
                      {SOCIAL_FORMATS.map((f) => (
                        <option key={f} value={f}>{FORMAT_LABEL[f]}</option>
                      ))}
                    </NativeSelect>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="sp-when">Termin</Label>
                  <Input id="sp-when" type="datetime-local" value={edit.plannedAt} onChange={(e) => set({ plannedAt: e.target.value })} className="max-sm:h-11" />
                </div>

                <div className="space-y-1.5">
                  <Label id="sp-status-label">Stand</Label>
                  <Segmented
                    aria-label="Stand"
                    value={edit.status}
                    onValueChange={(v) => set({ status: v })}
                    options={POST_STATUSES.map((s) => ({ value: s, label: POST_STATUS_LABEL[s] }))}
                    stretch
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <Label htmlFor="sp-text">Text</Label>
                    <span className={edit.text.length > limit ? "text-xs tabular-nums text-destructive" : "text-xs tabular-nums text-muted-foreground"}>
                      {nf.format(edit.text.length)} / {nf.format(limit)}
                    </span>
                  </div>
                  <Textarea
                    id="sp-text"
                    value={edit.text}
                    rows={7}
                    aria-invalid={edit.text.length > limit || undefined}
                    placeholder={`Text für ${CHANNEL_LABEL[edit.channel]}`}
                    onChange={(e) => set({ text: e.target.value })}
                  />
                  {campaign.hashtags && (
                    <p className="text-xs text-muted-foreground">Beim Kopieren kommen fehlende Hashtags dazu: {campaign.hashtags}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Bilder und Videos</Label>
                  {edit.media.length > 0 && (
                    <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                      {edit.media.map((url, i) => (
                        <li key={`${url}-${i}`} className="glass-tile relative aspect-square overflow-hidden">
                          {isVideo(url) ? (
                            <a href={url} target="_blank" rel="noreferrer" className="flex h-full w-full flex-col items-center justify-center gap-1 text-xs text-muted-foreground">
                              <Film className="h-5 w-5" />
                              Video {i + 1}
                            </a>
                          ) : (
                            <a href={url} target="_blank" rel="noreferrer" className="block h-full w-full">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={url} alt={`Bild ${i + 1}`} className="h-full w-full object-cover" loading="lazy" />
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={() => set({ media: edit.media.filter((_, j) => j !== i) })}
                            className="press absolute top-1 right-1 inline-flex size-8 items-center justify-center rounded-full bg-popover text-foreground ring-1 ring-glass-border"
                            aria-label={`Bild ${i + 1} entfernen`}
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      value={newMedia}
                      onChange={(e) => setNewMedia(e.target.value)}
                      placeholder="https://… (Bild oder Video)"
                      spellCheck={false}
                      inputMode="url"
                      aria-label="Adresse eines Bildes oder Videos"
                      className="max-sm:h-11 sm:flex-1"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          if (isHttpsUrl(newMedia.trim())) {
                            set({ media: [...edit.media, newMedia.trim()].slice(0, 10) });
                            setNewMedia("");
                          }
                        }
                      }}
                    />
                    <div className="grid grid-cols-2 gap-2 sm:flex">
                      <Button
                        type="button"
                        variant="outline"
                        className="max-sm:h-11"
                        disabled={!isHttpsUrl(newMedia.trim()) || edit.media.length >= 10}
                        onClick={() => {
                          set({ media: [...edit.media, newMedia.trim()].slice(0, 10) });
                          setNewMedia("");
                        }}
                      >
                        <Plus className="h-4 w-4" />
                        Adresse
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="max-sm:h-11"
                        disabled={uploading || edit.media.length >= 10}
                        onClick={() => fileInput.current?.click()}
                      >
                        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                        Hochladen
                      </Button>
                    </div>
                    <input
                      ref={fileInput}
                      type="file"
                      accept="image/*"
                      multiple
                      className="sr-only"
                      tabIndex={-1}
                      aria-hidden
                      onChange={(e) => {
                        const files = e.target.files;
                        if (files?.length) void upload(files);
                        e.target.value = "";
                      }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Fotos werden auf 1440 px verkleinert, ohne Standort und Metadaten, und liegen öffentlich abrufbar. Videos als Adresse eintragen.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="sp-link">Link</Label>
                  <Input
                    id="sp-link"
                    value={edit.link}
                    inputMode="url"
                    spellCheck={false}
                    placeholder="https://… (Story-Link, Bio, Facebook)"
                    onChange={(e) => set({ link: e.target.value })}
                    className="max-sm:h-11"
                  />
                  {campaignUrl && edit.link.trim() !== campaignUrl && (
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto min-h-11 max-w-full justify-start px-0 text-left text-xs whitespace-normal sm:min-h-0"
                      onClick={() => set({ link: campaignUrl })}
                    >
                      <Link2 className="h-3.5 w-3.5" />
                      Ziel-Link mit Kampagnen-Zusatz einsetzen
                    </Button>
                  )}
                </div>

                {edit.status === "PUBLISHED" && (
                  <div className="glass-tile space-y-3 p-3">
                    <p className="text-[13px] font-medium text-foreground">Nach dem Posten</p>
                    <div className="space-y-1.5">
                      <Label htmlFor="sp-url">Link zum Beitrag</Label>
                      <Input id="sp-url" value={edit.postUrl} inputMode="url" spellCheck={false} placeholder="https://www.instagram.com/p/…" onChange={(e) => set({ postUrl: e.target.value })} className="max-sm:h-11" />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {([
                        ["reach", "Erreicht"],
                        ["interactions", "Interaktionen"],
                        ["clicks", "Link-Klicks"],
                      ] as const).map(([key, label]) => (
                        <div key={key} className="min-w-0 space-y-1.5">
                          <Label htmlFor={`sp-${key}`} className="truncate">{label}</Label>
                          <Input
                            id={`sp-${key}`}
                            value={edit[key]}
                            inputMode="numeric"
                            placeholder="–"
                            onChange={(e) => set({ [key]: e.target.value.replace(/[^\d]/g, "") } as Partial<EditPost>)}
                            className="tabular-nums max-sm:h-11"
                          />
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">Zahlen aus der Statistik des Kanals (z. B. Meta Business Suite). Interaktionen: Likes, Kommentare, Teilen, Speichern.</p>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="sp-notes">Notiz</Label>
                  <Textarea id="sp-notes" value={edit.notes} rows={2} maxLength={2000} placeholder="Musik, Markierungen, Absprachen" onChange={(e) => set({ notes: e.target.value })} />
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  {copy && <CopyButton text={copy} />}
                  {canShare && (copy || edit.media.length > 0) && (
                    <Button type="button" variant="outline" className="max-sm:h-11" onClick={() => void sharePost(copy, edit.media)}>
                      <Share2 className="h-4 w-4" />
                      Teilen (Text ist kopiert)
                    </Button>
                  )}
                  {edit.id && (
                    <Button
                      type="button"
                      variant="outline"
                      className="max-sm:h-11"
                      onClick={() => open({ ...edit, id: null, status: edit.status === "PUBLISHED" ? "DRAFT" : edit.status, postUrl: "", reach: "", interactions: "", clicks: "" })}
                    >
                      <CopyPlus className="h-4 w-4" />
                      Als neuen Beitrag kopieren
                    </Button>
                  )}
                </div>

                {error && <Notice tone="danger" compact title={error} />}

                {confirmDelete ? (
                  <ConfirmStep
                    title="Beitrag löschen?"
                    description="Text, Termin und Zahlen gehen verloren. Hochgeladene Bilder bleiben unter ihrer Adresse erreichbar."
                    pending={busy}
                    onConfirm={() => void remove()}
                    onCancel={() => setConfirmDelete(false)}
                  />
                ) : (
                  <DialogFooter
                    start={
                      edit.id ? (
                        <Button type="button" variant="ghost" className="text-destructive max-sm:h-11" onClick={() => setConfirmDelete(true)} disabled={busy}>
                          <Trash2 className="h-4 w-4" />
                          Löschen
                        </Button>
                      ) : undefined
                    }
                  >
                    <Button type="button" variant="outline" onClick={close} disabled={busy} className="max-sm:h-11">
                      Abbrechen
                    </Button>
                    <Button type="submit" disabled={busy || uploading || edit.text.length > limit} className="min-w-24 max-sm:h-11">
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Speichern"}
                    </Button>
                  </DialogFooter>
                )}
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
