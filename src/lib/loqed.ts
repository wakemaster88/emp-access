/**
 * LOQED Integrations-API.
 *
 * Doku: https://support.loqed.com/en/articles/6127911-loqed-web-api-integration
 *
 * Warum ueberhaupt eine eigene Anbindung, obwohl das Schloss auch in der Shelly
 * Cloud steht: Die Shelly Cloud liefert seinen Zustand (`bolt_state`, Batterie),
 * nimmt fuer Schloesser aber keine Befehle an. Am echten Konto geprueft –
 * `set/lock` und die v1-Pfade antworten mit "Requested method was not found",
 * ein Schaltbefehl mit `DEVICE_FAILED_COMMAND`. Gefahren wird das Schloss
 * deshalb hier.
 *
 * Authentifizierung: ein persoenlicher Zugriffstoken als Bearer-Token, zu
 * erstellen unter
 * https://integrations.production.loqed.com/personal-access-tokens
 * (LOQED-Konto mit Administratorrechten). Keine Signaturen, keine
 * Schluessel-IDs – anders als bei der aelteren Webhook-API.
 */

import type { LoqedBoltState } from "./loqed-constants";

const LOQED_BASE_URL = "https://integrations.production.loqed.com";

export interface LoqedLock {
  id: string;
  name?: string;
  model_name?: string;
  battery_percentage?: number;
  battery_type?: string;
  bolt_state?: string;
  party_mode?: boolean;
  guest_access_mode?: boolean;
  twist_assist?: boolean;
  touch_to_connect?: boolean;
  lock_direction?: string;
  mortise_lock_type?: string;
  supported_lock_states?: string[];
}

export interface LoqedResult {
  ok: boolean;
  /// HTTP-Status; 0 = die Anfrage kam nicht zustande.
  status: number;
  /// Meldung in der Landessprache, wenn etwas nicht geklappt hat.
  error?: string;
}

/**
 * Fehler der LOQED-API in einen Satz uebersetzen, der die naechste Handlung
 * nennt. Ein blankes "HTTP 401" hilft niemandem weiter, der wissen will, ob es
 * am Token, am Schloss oder am Netz liegt.
 */
function errorText(status: number, path: string, body: unknown): string {
  const detail = typeof body === "string"
    ? body.slice(0, 160)
    : typeof (body as { message?: unknown })?.message === "string"
      ? String((body as { message: string }).message).slice(0, 160)
      : "";

  switch (status) {
    case 0:
      return "LOQED war nicht erreichbar (Zeitüberschreitung oder kein Netz).";
    case 401:
    case 403:
      return "LOQED hat den Zugriffstoken abgelehnt – bitte unter Einstellungen → LOQED erneuern.";
    case 404:
      return "LOQED kennt dieses Schloss nicht (mehr). Bitte neu synchronisieren.";
    case 422:
      return `LOQED hat den Befehl abgelehnt${detail ? `: ${detail}` : " – dieser Riegelzustand wird nicht unterstützt."}`;
    case 429:
      return "LOQED bremst die Anfragen aus (zu viele in kurzer Zeit). Bitte kurz warten.";
    default:
      return `LOQED antwortete mit HTTP ${status} auf ${path}${detail ? `: ${detail}` : ""}`;
  }
}

interface LoqedFetchResult {
  ok: boolean;
  status: number;
  data: unknown;
  error?: string;
}

async function loqedFetch(
  token: string,
  path: string,
  { method = "GET", body, timeoutMs = 15_000 }: {
    method?: "GET" | "POST";
    body?: unknown;
    timeoutMs?: number;
  } = {},
): Promise<LoqedFetchResult> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token.trim()}`,
    Accept: "application/json",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  try {
    const res = await fetch(`${LOQED_BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });

    let data: unknown = null;
    const text = await res.text();
    if (text) {
      try { data = JSON.parse(text); } catch { data = text; }
    }

    if (!res.ok) {
      return { ok: false, status: res.status, data, error: errorText(res.status, path, data) };
    }
    return { ok: true, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null, error: errorText(0, path, null) };
  }
}

/**
 * Alle Schloesser des Kontos samt Zustand und Batterie.
 *
 * Dient sowohl dem Abgleich der Geraeteliste als auch als Statusabruf: Ein
 * Aufruf liefert alles, was EMP anzeigt.
 */
export async function loqedListLocks(token: string): Promise<{
  ok: boolean;
  status: number;
  locks: LoqedLock[];
  error?: string;
}> {
  const res = await loqedFetch(token, "/api/locks/");
  if (!res.ok) return { ok: false, status: res.status, locks: [], error: res.error };

  const list = (res.data as { data?: unknown })?.data;
  if (!Array.isArray(list)) {
    return {
      ok: false,
      status: res.status,
      locks: [],
      error: "LOQED hat eine unerwartete Antwort auf die Schlossliste geliefert.",
    };
  }

  // Ohne ID ist ein Schloss nicht ansprechbar – solche Einträge fliegen raus,
  // damit sie nicht als steuerbares Gerät in der Liste landen.
  const locks = (list as LoqedLock[]).filter((l) => typeof l.id === "string" && l.id.length > 0);
  return { ok: true, status: res.status, locks };
}

/** Einzelnes Schloss aus der Liste heraussuchen. */
export async function loqedGetLock(
  token: string,
  lockId: string,
): Promise<{ ok: boolean; lock: LoqedLock | null; error?: string }> {
  const res = await loqedListLocks(token);
  if (!res.ok) return { ok: false, lock: null, error: res.error };
  const lock = res.locks.find((l) => l.id === lockId) ?? null;
  return {
    ok: lock !== null,
    lock,
    ...(lock === null ? { error: "LOQED kennt dieses Schloss nicht (mehr). Bitte neu synchronisieren." } : {}),
  };
}

/**
 * Riegel in einen Zustand fahren.
 *
 * `open` zieht den Riegel ganz zurueck, sodass die Tuer aufgeht, und faellt
 * danach in die Tagverriegelung – das setzt eine Tuer ohne Aussenklinke voraus
 * (`mortise_lock_type: cylinder_operated_no_handle_on_the_outside`). Bei anderen
 * Bauarten lehnt LOQED den Befehl ab; `supported_lock_states` des Schlosses
 * sagt vorher, was geht.
 */
export async function loqedSetBoltState(
  token: string,
  lockId: string,
  state: LoqedBoltState,
): Promise<LoqedResult> {
  const res = await loqedFetch(
    token,
    `/api/locks/${encodeURIComponent(lockId)}/bolt_state/${state}`,
    // Der Motor braucht ein paar Sekunden; die API antwortet erst, wenn der
    // Befehl beim Schloss ist.
    { timeoutMs: 20_000 },
  );
  return { ok: res.ok, status: res.status, error: res.error };
}
