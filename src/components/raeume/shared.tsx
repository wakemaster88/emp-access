"use client";

/** Gemeinsame Anzeige- und Fetch-Helfer des Raum-Leitstands. */

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

const EVENT_TYPE_LABELS: Record<string, string> = {
  MOTION: "Bewegung",
  PERSON: "Person",
  VEHICLE: "Fahrzeug",
  ANIMAL: "Tier",
  DOORBELL: "Klingel",
  OTHER: "Ereignis",
};

export function deviceTypeLabel(type: string): string {
  return DEVICE_TYPE_LABELS[type] ?? type;
}

/** "Shelly · Beleuchtung" – kurze Herkunftszeile unter dem Gerätenamen. */
export function deviceMetaLabel(type: string, category: string | null): string {
  const cat = category ? DEVICE_CATEGORY_LABELS[category] ?? category : null;
  return [deviceTypeLabel(type), cat].filter(Boolean).join(" · ");
}

export function eventTypeLabel(type: string): string {
  return EVENT_TYPE_LABELS[type] ?? type;
}

/**
 * "vor 3 Min" – grobe Angabe, wie lange etwas her ist.
 *
 * `nowMs` wird bewusst uebergeben und nicht hier gelesen: Server und erster
 * Client-Render muessen denselben Bezugspunkt haben, sonst weicht das
 * hydrierte Markup ab (siehe `useNow`).
 */
export function fmtAgo(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return "–";
  const then = new Date(iso).getTime();
  if (isNaN(then)) return "–";
  const seconds = Math.round((nowMs - then) / 1000);
  if (seconds < 60) return "gerade eben";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `vor ${minutes} Min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `vor ${hours} Std`;
  const days = Math.round(hours / 24);
  return `vor ${days} ${days === 1 ? "Tag" : "Tagen"}`;
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
    <p className="rounded bg-rose-50 px-2 py-1.5 text-xs text-rose-600 dark:bg-rose-950/30">
      {message}
    </p>
  );
}
