"use client";

import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import {
  HANDOVER_STATUS_LABELS,
  KEY_LEVEL_LABELS,
  KEY_STATUS_LABELS,
  LOCK_TYPE_LABELS,
  type HandoverStatus,
  type KeyLevel,
  type KeyStatus,
} from "@/lib/keying";

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
  HUE_LIGHT: "Philips Hue",
  GARDENA_VALVE: "GARDENA",
  AUDIO_PLAYER: "Audio",
  MAMMOTION_MOWER: "Mammotion",
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

type BadgeVariant = React.ComponentProps<typeof Badge>["variant"];

const KEY_STATUS_VARIANTS: Record<string, BadgeVariant> = {
  AVAILABLE: "success",
  ISSUED: "warning",
  LOST: "danger",
  DESTROYED: "neutral",
};

const HANDOVER_STATUS_VARIANTS: Record<string, BadgeVariant> = {
  DRAFT: "neutral",
  ISSUED: "warning",
  PARTIALLY_RETURNED: "info",
  RETURNED: "success",
  LOST: "danger",
};

/**
 * Schlüsselart als neutrale Pille: die Art ist eine Kategorie, kein Zustand.
 * Farbe bleibt Schlüssel- und Protokollstatus vorbehalten (docs/design-regeln.md, Abschnitt 3).
 */
export function LevelBadge({ level }: { level: string }) {
  return (
    <Badge variant="neutral" className="font-medium">
      {levelLabel(level)}
    </Badge>
  );
}

export function KeyStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={KEY_STATUS_VARIANTS[status] ?? KEY_STATUS_VARIANTS.AVAILABLE}>
      {keyStatusLabel(status)}
    </Badge>
  );
}

export function HandoverStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={HANDOVER_STATUS_VARIANTS[status] ?? HANDOVER_STATUS_VARIANTS.DRAFT}>
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

/** Fehler am Formular oder an der Liste: kompakter Hinweis in Störungsfarbe. */
export function ErrorLine({ message }: { message: string }) {
  if (!message) return null;
  return <Notice tone="danger" compact title={message} />;
}

/** Leere Liste: ein Satz mit kleinem Symbol (EmptyState, kompakt). */
export function EmptyHint({ children, icon }: { children: string; icon?: LucideIcon }) {
  return <EmptyState compact icon={icon} title={children} />;
}
