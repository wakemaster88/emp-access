"use client";

import { useRef, useState } from "react";
import { Camera, Loader2, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { IconChip, type ChipTone } from "@/components/ui/icon-chip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resizeImageToDataUrl } from "@/components/lost-items/lost-item-dialog";

/** Bausteine der öffentlichen Zählseiten (Inventur und Inventar) am Handy. */

const NAME_KEY = "wawi-count-name";

export function readCounterName(): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveCounterName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* privates Fenster: Name gilt nur für diese Sitzung */
  }
}

export function Shell({ children, accountName }: { children: React.ReactNode; accountName?: string }) {
  return (
    <main className="page-ambient min-h-dvh px-4 py-6">
      <div className="mx-auto w-full max-w-xl">
        {accountName && <p className="text-label mb-3">{accountName}</p>}
        {children}
      </div>
    </main>
  );
}

export function StateCard({ icon, tone, title, text }: { icon: LucideIcon; tone: ChipTone; title: string; text: string }) {
  return (
    <Card className="items-center gap-3 px-6 py-10 text-center sm:py-10">
      <IconChip icon={icon} tone={tone} size="lg" className="size-14 rounded-tile [&_svg]:size-7" />
      <p className="text-base font-semibold text-foreground">{title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{text}</p>
    </Card>
  );
}

export function LoadingCard() {
  return (
    <Card className="flex-row items-center justify-center gap-2 py-16 text-sm text-muted-foreground sm:py-16">
      <Loader2 className="h-5 w-5 animate-spin" />
      Lädt …
    </Card>
  );
}

/** Einmal den eigenen Namen eingeben (bleibt auf dem Gerät gespeichert). */
export function NameGate({
  icon,
  title,
  subtitle,
  initial,
  onName,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  initial: string;
  onName: (name: string) => void;
}) {
  const [draft, setDraft] = useState(initial);
  return (
    <Card>
      <CardContent className="space-y-4 py-2">
        <div className="flex items-center gap-3">
          <IconChip icon={icon} tone="primary" size="lg" />
          <div className="min-w-0">
            <p className="font-semibold text-foreground [overflow-wrap:anywhere]">{title}</p>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const n = draft.trim().slice(0, 60);
            if (!n) return;
            saveCounterName(n);
            onName(n);
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="count-name">Dein Name</Label>
            <Input id="count-name" value={draft} onChange={(e) => setDraft(e.target.value)} autoComplete="name" autoFocus className="h-11" maxLength={60} />
            <p className="text-xs text-muted-foreground">Damit sieht das Büro, wer was gezählt hat.</p>
          </div>
          <Button type="submit" className="h-11 w-full" disabled={!draft.trim()}>
            Zählen starten
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * Foto aufnehmen für Artikel oder Posten ohne Bild: öffnet am Handy direkt
 * die Kamera, verkleinert auf 512 px und gibt eine JPEG-Data-URL weiter.
 */
export function PhotoButton({ label, onPhoto, onError }: { label: string; onPhoto: (dataUrl: string) => Promise<void>; onError: (message: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-11 shrink-0 text-muted-foreground"
        aria-label={label}
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-5 w-5" />}
      </Button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setBusy(true);
          try {
            await onPhoto(await resizeImageToDataUrl(file, 512));
          } catch {
            onError("Foto konnte nicht gelesen werden. Bitte noch einmal aufnehmen.");
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}

/** Foto an die Handy-API schicken; liefert eine Fehlermeldung oder null. */
export async function uploadPhoto(url: string, body: { name: string; id: number; image: string }): Promise<string | null> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) return null;
    const data = await res.json().catch(() => null);
    return typeof data?.error === "string" ? data.error : "Foto konnte nicht gespeichert werden.";
  } catch {
    return "Foto konnte nicht gespeichert werden. Prüfe die Verbindung.";
  }
}
