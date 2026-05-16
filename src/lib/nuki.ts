/**
 * Nuki Web API Client.
 *
 * Doku: https://developer.nuki.io/page/nuki-web-api-1.5/4
 *
 * Authentifizierung erfolgt per API-Token (im Nuki Web Account unter
 * "API" generierbar) im Authorization-Header. Das ist der einfachere
 * Weg gegenueber OAuth fuer einen einzelnen Account; OAuth waere noetig
 * wenn wir spaeter Drittnutzer-Accounts anbinden wollen.
 *
 * Voraussetzung pro Smart Lock: WLAN-faehig (Smart Lock Pro 4. Gen,
 * Smart Lock Ultra) ODER Nuki Bridge im LAN, damit das Geraet aus der
 * Cloud erreichbar ist.
 */

const NUKI_BASE_URL = "https://api.nuki.io";

/**
 * Smartlock-Action (siehe Nuki-Doku, Abschnitt "Smartlock action").
 * Achtung: Welche Actions ein Geraet versteht, haengt vom Device-Type ab
 *   (Smart Lock unterstuetzt 1-5, Opener unterstuetzt 1-3).
 */
export const NUKI_ACTION = {
  UNLOCK: 1,
  LOCK: 2,
  UNLATCH: 3,
  LOCK_N_GO: 4,
  LOCK_N_GO_WITH_UNLATCH: 5,
} as const;
export type NukiActionId = (typeof NUKI_ACTION)[keyof typeof NUKI_ACTION];

/**
 * Nuki Device Type. Aus der Web-API:
 *   0 = Smart Lock (1.0/2.0)
 *   1 = Opener (Tueroeffner)
 *   2 = Smart Door
 *   3 = Smart Lock 3.0 (Pro)
 *   4 = Smart Lock 4.0 (Pro)
 */
export const NUKI_DEVICE_TYPE_LABEL: Record<number, string> = {
  0: "Smart Lock",
  1: "Opener",
  2: "Smart Door",
  3: "Smart Lock 3.0",
  4: "Smart Lock 4.0",
};

export interface NukiSmartlock {
  smartlockId: number;
  accountId?: number;
  authId?: number;
  name?: string;
  type?: number;
  state?: {
    /// 0=uncalibrated, 1=locked, 2=unlocking, 3=unlocked, 4=locking,
    /// 5=unlatched, 6=unlocked (lock'n'go), 7=unlatching, 254=motor blocked,
    /// 255=undefined.
    state?: number;
    stateName?: string;
    batteryCritical?: boolean;
    batteryCharging?: boolean;
    batteryCharge?: number;
    keypadBatteryCritical?: boolean;
    doorState?: number;
    lastAction?: number;
    trigger?: number;
  };
  firmwareVersion?: string | number;
  serverState?: number;
  adminPinState?: number;
  virtualDevice?: boolean;
  bleAddress?: string;
}

export interface NukiActionResult {
  ok: boolean;
  status?: number;
  error?: string;
}

interface NukiFetchOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  timeoutMs?: number;
}

async function nukiFetch(
  token: string,
  path: string,
  { method = "GET", body, timeoutMs = 10_000 }: NukiFetchOptions = {},
): Promise<{ ok: boolean; status: number; data: unknown; error?: string }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token.trim()}`,
    Accept: "application/json",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  try {
    const res = await fetch(`${NUKI_BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });

    let data: unknown = null;
    const text = await res.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        data,
        error: `Nuki ${method} ${path} → ${res.status} ${res.statusText}`,
      };
    }
    return { ok: true, status: res.status, data };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: err instanceof Error ? err.message : "Nuki fetch failed",
    };
  }
}

/** Listet alle Smart Locks/Opener fuer den Account des Tokens. */
export async function nukiListSmartlocks(token: string): Promise<NukiSmartlock[]> {
  const res = await nukiFetch(token, "/smartlock");
  if (!res.ok || !Array.isArray(res.data)) return [];
  return res.data as NukiSmartlock[];
}

/** Aktuellen State eines Smart Locks holen. */
export async function nukiGetSmartlock(
  token: string,
  smartlockId: string | number,
): Promise<NukiSmartlock | null> {
  const res = await nukiFetch(token, `/smartlock/${smartlockId}`);
  if (!res.ok) return null;
  return res.data as NukiSmartlock;
}

/**
 * Action auf einem Smart Lock ausloesen.
 *
 * @param token Nuki Web API Token
 * @param smartlockId Numerische ID (von /smartlock)
 * @param action NUKI_ACTION.UNLOCK | LOCK | UNLATCH | LOCK_N_GO | LOCK_N_GO_WITH_UNLATCH
 * @param option Bit-Feld (0 = none, 1 = force, 2 = full lock). Default 0.
 */
export async function nukiAction(
  token: string,
  smartlockId: string | number,
  action: NukiActionId,
  option: number = 0,
): Promise<NukiActionResult> {
  const res = await nukiFetch(token, `/smartlock/${smartlockId}/action`, {
    method: "POST",
    body: { action, option },
    timeoutMs: 15_000,
  });
  return { ok: res.ok, status: res.status, error: res.error };
}

/** Convenience-Wrapper fuer "Tuer einmalig oeffnen" (entspricht Unlatch). */
export async function nukiUnlock(
  token: string,
  smartlockId: string | number,
): Promise<NukiActionResult> {
  return nukiAction(token, smartlockId, NUKI_ACTION.UNLOCK);
}

export async function nukiLock(
  token: string,
  smartlockId: string | number,
): Promise<NukiActionResult> {
  return nukiAction(token, smartlockId, NUKI_ACTION.LOCK);
}

export async function nukiUnlatch(
  token: string,
  smartlockId: string | number,
): Promise<NukiActionResult> {
  return nukiAction(token, smartlockId, NUKI_ACTION.UNLATCH);
}

// ── Webhooks (Nuki "Notifications") ──────────────────────────────────────────

/**
 * Trigger-Filter fuer Notifications.
 * Aus der Doku: stringbasiert. Wir abonnieren standardmaessig die fuer ein
 * Zutrittssystem interessanten Trigger.
 */
export const DEFAULT_NOTIFICATION_TRIGGERS = [
  "DeviceStatus",
  "DeviceConfig",
  "Settings",
  "DeviceLogs",
] as const;

export interface NukiNotification {
  notificationId?: string;
  referenceId?: string;
  pushId?: string;
  webhookUrl?: string;
  triggers?: string[];
}

export async function nukiListNotifications(token: string): Promise<NukiNotification[]> {
  const res = await nukiFetch(token, "/notification");
  if (!res.ok || !Array.isArray(res.data)) return [];
  return res.data as NukiNotification[];
}

/**
 * Registriert (oder ueberschreibt) eine Webhook-Notification.
 * Nuki ruft die URL bei den angegebenen Triggern per POST mit JSON-Body auf.
 *
 * Achtung: Die URL muss oeffentlich erreichbar sein. In Dev kann z. B. ein
 * Tunnel (cloudflared/ngrok) genutzt werden.
 */
export async function nukiUpsertWebhook(
  token: string,
  webhookUrl: string,
  triggers: readonly string[] = DEFAULT_NOTIFICATION_TRIGGERS,
): Promise<{ ok: boolean; notificationId?: string; error?: string }> {
  const existing = await nukiListNotifications(token);
  const match = existing.find((n) => n.webhookUrl === webhookUrl);

  if (match?.notificationId) {
    const res = await nukiFetch(token, `/notification/${match.notificationId}`, {
      method: "POST",
      body: {
        notificationId: match.notificationId,
        referenceId: match.referenceId ?? "emp-access",
        webhookUrl,
        triggers: [...triggers],
      },
    });
    return { ok: res.ok, notificationId: match.notificationId, error: res.error };
  }

  const res = await nukiFetch(token, "/notification/webhook", {
    method: "PUT",
    body: {
      referenceId: "emp-access",
      webhookUrl,
      triggers: [...triggers],
    },
  });
  if (!res.ok) return { ok: false, error: res.error };
  const data = res.data as { notificationId?: string } | null;
  return { ok: true, notificationId: data?.notificationId };
}

export async function nukiDeleteWebhook(
  token: string,
  notificationId: string,
): Promise<boolean> {
  const res = await nukiFetch(token, `/notification/${notificationId}`, {
    method: "DELETE",
  });
  return res.ok;
}

/** Klartext-Label fuer den `state` einer Notification (Doku-Mapping). */
export function nukiStateLabel(state: number | undefined): string {
  if (state == null) return "unknown";
  switch (state) {
    case 0: return "uncalibrated";
    case 1: return "locked";
    case 2: return "unlocking";
    case 3: return "unlocked";
    case 4: return "locking";
    case 5: return "unlatched";
    case 6: return "unlocked (lock'n'go)";
    case 7: return "unlatching";
    case 254: return "motor blocked";
    case 255: return "undefined";
    default: return `state ${state}`;
  }
}

/**
 * Mapping fuer den `trigger` einer Notification / eines Log-Events.
 * 0=system, 1=manual, 2=button, 3=automatic, 4=app, 5=website,
 * 6=auto-lock, 7=schedule, 172=accesscontrol, 173=keypad.
 */
export function nukiTriggerLabel(trigger: number | undefined): string {
  if (trigger == null) return "unknown";
  switch (trigger) {
    case 0: return "system";
    case 1: return "manual";
    case 2: return "button";
    case 3: return "automatic";
    case 4: return "app";
    case 5: return "website";
    case 6: return "auto-lock";
    case 7: return "schedule";
    case 172: return "accesscontrol";
    case 173: return "keypad";
    default: return `trigger ${trigger}`;
  }
}
