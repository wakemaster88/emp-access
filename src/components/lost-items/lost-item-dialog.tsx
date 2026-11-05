"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Notice } from "@/components/ui/notice";
import { Segmented } from "@/components/ui/segmented";
import { Loader2, Trash2, Save, ImagePlus, X } from "lucide-react";

export type LostItemKind = "FOUND" | "LOST_REPORT";

export interface LostItemData {
  id: number;
  kind: LostItemKind;
  description: string;
  foundDate: string;
  image: string | null;
  contact: string | null;
  reporterName: string | null;
  callbackPhone: string | null;
  pickedUp: boolean;
  pickedUpAt: string | null;
}

interface LostItemDialogProps {
  item: LostItemData | null;
  open: boolean;
  onClose: () => void;
}

export async function resizeImageToDataUrl(file: File, maxSize = 1024): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Datei konnte nicht gelesen werden"));
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new window.Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Bild konnte nicht geladen werden"));
    el.src = dataUrl;
  });
  const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.8);
}

function toDateInputValue(s: string | null): string {
  const d = s ? new Date(s) : new Date();
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

export function LostItemDialog({ item, open, onClose }: LostItemDialogProps) {
  const router = useRouter();
  const isNew = !item;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [kind, setKind] = useState<LostItemKind>("FOUND");
  const [description, setDescription] = useState("");
  const [foundDate, setFoundDate] = useState(toDateInputValue(null));
  const [contact, setContact] = useState("");
  const [reporterName, setReporterName] = useState("");
  const [callbackPhone, setCallbackPhone] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [pickedUp, setPickedUp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Rückfrage zum Löschen als Schritt im selben Dialog (Abschnitt 18), kein Browser-Dialog.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setError("");
      setConfirmDelete(false);
      setKind(item?.kind ?? "FOUND");
      setDescription(item?.description ?? "");
      setFoundDate(toDateInputValue(item?.foundDate ?? null));
      setContact(item?.contact ?? "");
      setReporterName(item?.reporterName ?? "");
      setCallbackPhone(item?.callbackPhone ?? "");
      setImage(item?.image ?? null);
      setPickedUp(item?.pickedUp ?? false);
    }
  }, [open, item]);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    try {
      setImage(await resizeImageToDataUrl(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bild konnte nicht verarbeitet werden");
    }
  }

  async function handleSave() {
    if (!description.trim()) {
      setError("Beschreibung erforderlich");
      return;
    }
    if (kind === "LOST_REPORT") {
      if (!reporterName.trim()) {
        setError("Name erforderlich");
        return;
      }
    }
    setSaving(true);
    setError("");
    try {
      const payload = {
        kind,
        description: description.trim(),
        foundDate: kind === "FOUND" ? foundDate : (foundDate || toDateInputValue(null)),
        contact: kind === "FOUND" ? (contact.trim() || null) : null,
        reporterName: kind === "LOST_REPORT" ? reporterName.trim() : null,
        callbackPhone: kind === "LOST_REPORT" ? (callbackPhone.trim() || null) : null,
        image: kind === "FOUND" ? image : null,
        pickedUp,
      };
      const url = isNew ? "/api/lost-items" : `/api/lost-items/${item!.id}`;
      const method = isNew ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(typeof data?.error === "string" ? data.error : `Server-Fehler (${res.status})`);
        return;
      }
      router.refresh();
      onClose();
    } catch (err) {
      setError(`Netzwerkfehler: ${err instanceof Error ? err.message : "unbekannt"}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!item) return;
    setDeleting(true);
    setError("");
    try {
      const res = await fetch(`/api/lost-items/${item.id}`, { method: "DELETE" });
      if (!res.ok) {
        setError(`Löschen fehlgeschlagen (${res.status})`);
        return;
      }
      router.refresh();
      onClose();
    } finally {
      setDeleting(false);
    }
  }

  const isLostReport = kind === "LOST_REPORT";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isNew
              ? (isLostReport ? "Verlustmeldung erfassen" : "Fundsache anlegen")
              : (isLostReport ? "Verlustmeldung bearbeiten" : "Fundsache bearbeiten")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {isNew && (
            // Art des Eintrags als Segmentwahl; die Kapsel ist in der Ebene getönt (Abschnitt 18).
            <Segmented
              aria-label="Art des Eintrags"
              stretch
              value={kind}
              onValueChange={setKind}
              options={[
                { value: "FOUND", label: "Fundsache" },
                { value: "LOST_REPORT", label: "Verlustmeldung" },
              ]}
            />
          )}

          <div className="space-y-1.5">
            <Label htmlFor="li-description">
              {isLostReport ? "Was wurde verloren? *" : "Beschreibung *"}
            </Label>
            <Textarea
              id="li-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder={
                isLostReport
                  ? "z. B. Schwarze Lederjacke, Größe M, mit Schlüsselbund"
                  : "z. B. Schwarze Jacke, Größe M, am Eingang gefunden"
              }
              className="resize-none"
            />
          </div>

          {isLostReport ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="li-reporterName">Name *</Label>
                <Input
                  id="li-reporterName"
                  value={reporterName}
                  onChange={(e) => setReporterName(e.target.value)}
                  maxLength={120}
                  placeholder="Max Mustermann"
                  className="h-11 sm:h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="li-callbackPhone">Rückrufnummer</Label>
                <Input
                  id="li-callbackPhone"
                  type="tel"
                  value={callbackPhone}
                  onChange={(e) => setCallbackPhone(e.target.value)}
                  maxLength={40}
                  placeholder="0170 1234567"
                  className="h-11 sm:h-9"
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="li-foundDate">Funddatum *</Label>
                <Input
                  id="li-foundDate"
                  type="date"
                  value={foundDate}
                  onChange={(e) => setFoundDate(e.target.value)}
                  className="h-11 sm:h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="li-contact">Kontakt</Label>
                <Input
                  id="li-contact"
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  maxLength={300}
                  placeholder="Name / Telefon"
                  className="h-11 sm:h-9"
                />
              </div>
            </div>
          )}

          {isLostReport && (
            <div className="space-y-1.5">
              <Label htmlFor="li-lostDate">Verlustdatum</Label>
              <Input
                id="li-lostDate"
                type="date"
                value={foundDate}
                onChange={(e) => setFoundDate(e.target.value)}
                className="h-11 sm:h-9"
              />
            </div>
          )}

          {!isLostReport && (
            <div className="space-y-1.5">
              <Label>Bild</Label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />
              {image ? (
                <div className="relative inline-block">
                  {/* eslint-disable-next-line @next/next/no-img-element -- Base64-Data-URL */}
                  <img
                    src={image}
                    alt="Fundsache"
                    className="h-32 w-32 rounded-tile object-cover border border-border"
                  />
                  <button
                    type="button"
                    onClick={() => setImage(null)}
                    // Unsichtbare Trefferfläche (after:-inset-1.5) bringt die 32-px-Taste auf 44 px.
                    className="absolute -top-2.5 -right-2.5 size-8 rounded-full bg-foreground text-background flex items-center justify-center hover:bg-destructive-fill hover:text-white transition-colors after:absolute after:-inset-1.5 after:rounded-full"
                    aria-label="Bild entfernen"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex flex-col items-center justify-center gap-1.5 h-32 w-32 rounded-tile border-2 border-dashed border-border bg-glass-tile text-muted-foreground hover:border-primary/60 hover:text-primary transition-colors"
                >
                  <ImagePlus className="h-6 w-6" />
                  <span className="text-xs">Bild wählen</span>
                </button>
              )}
            </div>
          )}

          {!isNew && (
            // Kästchen (Abschnitt 16): der Zustand wird erst mit „Speichern“ übernommen.
            // Die Beschriftung füllt die Zeile, so ist die ganze Zeile Tippfläche.
            <div className="glass-tile flex items-center gap-3 pl-3">
              <Checkbox
                id="li-pickedUp"
                checked={pickedUp}
                onCheckedChange={(checked) => setPickedUp(checked === true)}
              />
              <Label htmlFor="li-pickedUp" className="min-h-11 flex-1 cursor-pointer pr-3 text-sm font-medium text-foreground">
                {isLostReport ? "Erledigt" : "Abgeholt"}
              </Label>
            </div>
          )}

          {error && (
            <Notice tone="danger" compact title={error} />
          )}

          {confirmDelete ? (
            // Rückfrage statt Fußzeile: Abbrechen oder endgültig löschen.
            <div className="space-y-3 pt-2">
              <Notice tone="danger" compact title="Eintrag wirklich löschen?" />
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setConfirmDelete(false)}
                  disabled={deleting}
                  autoFocus
                  className="h-11 sm:h-9"
                >
                  Abbrechen
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="gap-1.5 h-11 sm:h-9"
                >
                  {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  Löschen
                </Button>
              </div>
            </div>
          ) : (
            /* Handy: volle Breite, Primärtaste oben, Löschen zuunterst. Ab sm: Löschen links (`DialogFooter start`), Handlungen rechts.
               „Löschen“ in Nebentextfarbe, rot erst beim Darüberfahren – wie in den Dialogen für Schließfächer, Vereine,
               Services und Ressourcen; rot ist die Taste in der Rückfrage. */
            <DialogFooter
              className="pt-2"
              start={!isNew ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setConfirmDelete(true)}
                  disabled={deleting || saving}
                  className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 gap-1.5 h-11 sm:h-9"
                >
                  <Trash2 className="h-4 w-4" />
                  Löschen
                </Button>
              ) : null}
            >
              <Button type="button" variant="outline" onClick={onClose} disabled={saving} className="h-11 sm:h-9">
                Abbrechen
              </Button>
              <Button
                type="button"
                onClick={handleSave}
                disabled={saving || deleting}
                className="gap-1.5 h-11 sm:h-9"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Speichern
              </Button>
            </DialogFooter>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
