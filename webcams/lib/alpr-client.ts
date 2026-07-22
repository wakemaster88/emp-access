import { loadConfig } from "./config";
import { sidecarAuthHeaders } from "./auth";

/**
 * Dünner Wrapper um den Sidecar-ALPR-Endpoint. Wir bauen die URL pro
 * Request frisch aus der Config — `tracker.url` kann sich zur Laufzeit
 * ändern (UI-Setting), ohne dass wir den Next-Server neu starten müssen.
 */

async function trackerBase(): Promise<string> {
  const config = await loadConfig();
  return config.settings.tracker.url.replace(/\/$/, "");
}

export async function alprFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = await trackerBase();
  const url = `${base}${path}`;
  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort(), 8000);
  try {
    return await fetch(url, {
      ...init,
      signal: ctl.signal,
      cache: "no-store",
      headers: { ...(await sidecarAuthHeaders()), ...(init?.headers as Record<string, string> | undefined) },
    });
  } finally {
    clearTimeout(timeout);
  }
}
