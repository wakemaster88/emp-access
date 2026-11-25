import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTime(d: Date, withSeconds = false, h12 = false) {
  return d.toLocaleTimeString(h12 ? "en-US" : "de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: withSeconds ? "2-digit" : undefined,
    hour12: h12,
  });
}

export function formatDate(d: Date) {
  return d.toLocaleDateString("de-DE", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

/**
 * Format für Kamera- und Widget-IDs, die neu angelegt werden (Stream-Namen
 * in der go2rtc.yaml, Schlüssel in Layouts). Bestehende IDs in der
 * config.json werden beim Lesen nicht geprüft.
 */
export const CONFIG_ID_RE = /^[a-z0-9_-]{1,40}$/;
export const CONFIG_ID_MAX = 40;

/** FNV-1a (32 Bit) als 6 Zeichen base36 – nur zum Unterscheiden gekürzter IDs. */
function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(7, "0").slice(-6);
}

/**
 * Automatisch erzeugte ID (`cam-…`, `w-…`) auf die erlaubte Länge kürzen.
 * Wird gekürzt, hängt ein kurzer Hash der vollen ID an, damit lange Namen
 * mit gleichem Anfang verschiedene IDs ergeben. Kurze IDs bleiben gleich.
 */
export function clampConfigId(id: string): string {
  if (id.length <= CONFIG_ID_MAX) return id.replace(/-+$/, "");
  const suffix = `-${shortHash(id)}`;
  return `${id.slice(0, CONFIG_ID_MAX - suffix.length).replace(/-+$/, "")}${suffix}`;
}
