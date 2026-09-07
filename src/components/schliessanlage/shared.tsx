"use client";

import { Badge } from "@/components/ui/badge";
import {
  HANDOVER_STATUS_LABELS,
  KEY_LEVEL_LABELS,
  KEY_STATUS_LABELS,
  LOCK_TYPE_LABELS,
  type HandoverStatus,
  type KeyLevel,
  type KeyStatus,
} from "@/lib/keying";
import { cn } from "@/lib/utils";

/** Gemeinsame Anzeige- und Fetch-Helfer der Schliessanlage-Tabs. */

export function levelLabel(level: string): string {
  return KEY_LEVEL_LABELS[level as KeyLevel] ?? level;
}

export function keyStatusLabel(status: string): string {
  return KEY_STATUS_LABELS[status as KeyStatus] ?? status;
}

export function lockTypeLabel(type: string): string {
  return LOCK_TYPE_LABELS[type] ?? type;
}

export function handoverStatusLabel(status: string): string {
  return HANDOVER_STATUS_LABELS[status as HandoverStatus] ?? status;
}

const DEVICE_TYPE_LABELS: Record<string, string> = {
  RASPBERRY_PI: "Raspberry Pi",
  SHELLY: "Shelly",
  NUKI_SMARTLOCK: "Nuki",
  LOQED_SMARTLOCK: "LOQED",
  GARDENA_VALVE: "GARDENA",
  AUDIO_PLAYER: "Audio",
};

const DEVICE_CATEGORY_LABELS: Record<string, string> = {
  DREHKREUZ: "Drehkreuz",
  TUER: "Tür",
  SENSOR: "Sensor",
  SCHALTER: "Schalter",
  BELEUCHTUNG: "Beleuchtung",
  AUDIO: "Audio",
  MARKISE: "Markise",
  ROLLTOR: "Rolltor",
  TASTER: "Taster",
};

export function deviceTypeLabel(type: string): string {
  return DEVICE_TYPE_LABELS[type] ?? type;
}

/** "Shelly · Schalter" – kurze Herkunftszeile unter dem Gerätenamen. */
export function deviceMetaLabel(type: string, category: string | null): string {
  const cat = category ? DEVICE_CATEGORY_LABELS[category] ?? category : null;
  return [deviceTypeLabel(type), cat].filter(Boolean).join(" · ");
}

/** Geräte, die einen Schließpunkt elektronisch öffnen können. */
export function canOpenLock(type: string, category: string | null): boolean {
  return (
    type === "NUKI_SMARTLOCK" ||
    type === "LOQED_SMARTLOCK" ||
    (type === "SHELLY" && (category === "TUER" || category === "DREHKREUZ" || category === "TASTER"))
  );
}

const LEVEL_CLASSES: Record<string, string> = {
  SINGLE: "bg-muted text-muted-foreground",
  GROUP: "bg-info/12 text-info",
  MAIN: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  GRAND: "bg-warning/14 text-warning",
};

const KEY_STATUS_CLASSES: Record<string, string> = {
  AVAILABLE: "bg-success/12 text-success",
  ISSUED: "bg-warning/10 text-warning ",
  LOST: "bg-destructive/12 text-destructive",
  DESTROYED: "bg-border text-muted-foreground dark:bg-accent dark:text-foreground/80",
};

const HANDOVER_STATUS_CLASSES: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  ISSUED: "bg-warning/10 text-warning ",
  PARTIALLY_RETURNED: "bg-info/12 text-info",
  RETURNED: "bg-success/12 text-success",
  LOST: "bg-destructive/12 text-destructive",
};

export function LevelBadge({ level }: { level: string }) {
  return (
    <Badge className={cn("text-[10px] py-0 font-medium", LEVEL_CLASSES[level] ?? LEVEL_CLASSES.SINGLE)}>
      {levelLabel(level)}
    </Badge>
  );
}

export function KeyStatusBadge({ status }: { status: string }) {
  return (
    <Badge className={cn("text-[10px] py-0", KEY_STATUS_CLASSES[status] ?? KEY_STATUS_CLASSES.AVAILABLE)}>
      {keyStatusLabel(status)}
    </Badge>
  );
}

export function HandoverStatusBadge({ status }: { status: string }) {
  return (
    <Badge className={cn("text-[10px] py-0", HANDOVER_STATUS_CLASSES[status] ?? HANDOVER_STATUS_CLASSES.DRAFT)}>
      {handoverStatusLabel(status)}
    </Badge>
  );
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "–";
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "–";
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** ISO -> "YYYY-MM-DD" für `<input type="date">`. */
export function isoToDateInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; message: string };

/** Fetch-Wrapper, der Zod- und Server-Fehler in eine Meldung uebersetzt. */
export async function apiRequest<T = unknown>(
  url: string,
  method: "POST" | "PUT" | "DELETE",
  body?: unknown,
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method,
      ...(body !== undefined && {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      const err = payload?.error;
      if (typeof err === "string") return { ok: false, message: err };
      const fieldErrors = err?.fieldErrors as Record<string, string[]> | undefined;
      const first = fieldErrors && Object.values(fieldErrors).flat()[0];
      const formError = (err?.formErrors as string[] | undefined)?.[0];
      return { ok: false, message: first || formError || `Server-Fehler (${res.status})` };
    }
    return { ok: true, data: payload as T };
  } catch (e) {
    return { ok: false, message: `Netzwerkfehler: ${e instanceof Error ? e.message : "unbekannt"}` };
  }
}

export function ErrorLine({ message }: { message: string }) {
  if (!message) return null;
  return (
    <p className="rounded bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
      {message}
    </p>
  );
}

export function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-dashed border-border py-6 text-center text-xs text-muted-foreground/70 dark:border-border">
      {children}
    </p>
  );
}
