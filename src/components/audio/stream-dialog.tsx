"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StreamRow } from "./types";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  stream: StreamRow | null;
}

export function StreamDialog({ open, onClose, onSaved, stream }: Props) {
  const isEdit = !!stream;
  const [name, setName] = useState(stream?.name ?? "");
  const [url, setUrl] = useState(stream?.url ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    if (!name.trim()) {
      setError("Name ist erforderlich");
      return;
    }
    if (!url.trim()) {
      setError("Stream-URL ist erforderlich");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(
        isEdit ? `/api/audio/streams/${stream!.id}` : "/api/audio/streams",
        {
          method: isEdit ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim(), url: url.trim() }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === "string" ? data.error : "Speichern fehlgeschlagen");
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Webradio bearbeiten" : "Neuer Webradio-Sender"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="as-name">Name</Label>
            <Input
              id="as-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z. B. Radio WAF"
            />
          </div>
          <div>
            <Label htmlFor="as-url">Stream-URL</Label>
            <Input
              id="as-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://stream.example.com/live.mp3"
            />
            <p className="mt-1 text-xs text-slate-500">
              Direkte Audio-Adresse (http oder https). In der Zone wählst du
              danach nur noch den Namen.
            </p>
          </div>
          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-600 dark:border-red-900/40 dark:bg-red-950/20">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Abbrechen
          </Button>
          <Button onClick={save} disabled={saving} className={cn("gap-1.5", saving && "opacity-80")}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? "Speichern" : "Anlegen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
