"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Trash2, Save, ImagePlus, X } from "lucide-react";

export interface LostItemData {
  id: number;
  description: string;
  foundDate: string;
  image: string | null;
  contact: string | null;
  pickedUp: boolean;
  pickedUpAt: string | null;
}

interface LostItemDialogProps {
  item: LostItemData | null;
  open: boolean;
  onClose: () => void;
}

/**
 * Verkleinert ein Bild clientseitig auf max. 1024px Kantenlänge und gibt es
 * als JPEG-Data-URL zurück – hält die Base64-Strings in der DB klein.
 */
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

  const [description, setDescription] = useState("");
  const [foundDate, setFoundDate] = useState(toDateInputValue(null));
  const [contact, setContact] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [pickedUp, setPickedUp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setError("");
      setDescription(item?.description ?? "");
      setFoundDate(toDateInputValue(item?.foundDate ?? null));
      setContact(item?.contact ?? "");
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
    setSaving(true);
    setError("");
    try {
      const payload = {
        description: description.trim(),
        foundDate,
        contact: contact.trim() || null,
        image,
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
    if (!confirm("Fundsache wirklich löschen?")) return;
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

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isNew ? "Fundsache anlegen" : "Fundsache bearbeiten"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="li-description">Beschreibung *</Label>
            <textarea
              id="li-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="z. B. Schwarze Jacke, Größe M, am Eingang gefunden"
              className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="li-foundDate">Funddatum *</Label>
              <Input
                id="li-foundDate"
                type="date"
                value={foundDate}
                onChange={(e) => setFoundDate(e.target.value)}
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
              />
            </div>
          </div>

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
                  className="h-32 w-32 rounded-lg object-cover border border-slate-200 dark:border-slate-700"
                />
                <button
                  type="button"
                  onClick={() => setImage(null)}
                  className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-slate-900 text-white flex items-center justify-center hover:bg-red-600 transition-colors"
                  aria-label="Bild entfernen"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center justify-center gap-1.5 h-32 w-32 rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-700 text-slate-400 hover:border-indigo-400 hover:text-indigo-500 transition-colors"
              >
                <ImagePlus className="h-6 w-6" />
                <span className="text-xs">Bild wählen</span>
              </button>
            )}
          </div>

          {!isNew && (
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={pickedUp}
                onChange={(e) => setPickedUp(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              Abgeholt
            </label>
          )}

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          <div className="flex items-center justify-between pt-2">
            {!isNew ? (
              <Button
                type="button"
                variant="ghost"
                onClick={handleDelete}
                disabled={deleting || saving}
                className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30 gap-1.5"
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Löschen
              </Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
                Abbrechen
              </Button>
              <Button
                type="button"
                onClick={handleSave}
                disabled={saving || deleting}
                className="bg-indigo-600 hover:bg-indigo-700 gap-1.5"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Speichern
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
