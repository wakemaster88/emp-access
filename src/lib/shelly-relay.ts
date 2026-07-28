/**
 * Einzelne Shelly-Relaiskanaele schalten – lokal (Gen2 RPC, Gen1 HTTP) mit
 * Cloud-Fallback. Gemeinsame Basis fuer einfache Schalter (`device-open.ts`)
 * und Antriebe mit zwei Fahrtrichtungen (`shelly-cover.ts`).
 */

import { normalizeShellyServer } from "./shelly-cloud";

export interface ShellyCloudCreds {
  /// Cloud-Host aus ApiConfig.baseUrl, mit oder ohne Schema.
  baseUrl: string;
  /// Auth-Key aus ApiConfig.token.
  token: string;
}

/**
 * Schaltet einen Kanal ueber die lokale IP. Probiert Gen2 (POST, dann GET) und
 * faellt auf Gen1 zurueck – die Generation ist nicht in der DB hinterlegt.
 *
 * `timerSec` nutzt den geraeteeigenen Auto-Off-Timer: Das Relais faellt auch
 * dann wieder ab, wenn die Verbindung danach abreisst.
 */
export async function shellySetRelayLocal(
  ip: string,
  channel: number,
  on: boolean,
  timerSec?: number,
): Promise<boolean> {
  // Gen2: POST /rpc/Switch.Set
  try {
    const body: Record<string, unknown> = { id: channel, on };
    if (timerSec) body.toggle_after = timerSec;
    const res = await fetch(`http://${ip}/rpc/Switch.Set`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) return true;
  } catch { /* try Gen2 GET */ }

  // Gen2 GET fallback
  try {
    const params = new URLSearchParams({ id: String(channel), on: on ? "true" : "false" });
    if (timerSec) params.set("toggle_after", String(timerSec));
    const res = await fetch(`http://${ip}/rpc/Switch.Set?${params}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) return true;
  } catch { /* try Gen1 */ }

  // Gen1: /relay/{idx}?turn=on|off
  try {
    let url = `http://${ip}/relay/${channel}?turn=${on ? "on" : "off"}`;
    if (timerSec) url += `&timer=${timerSec}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (res.ok) return true;
  } catch { /* unavailable */ }

  return false;
}

/** Schaltet einen Kanal ueber die Shelly Cloud (Fallback, wenn kein LAN-Zugriff). */
export async function shellySetRelayCloud(
  creds: ShellyCloudCreds,
  baseId: string,
  channel: number,
  on: boolean,
  timerSec?: number,
): Promise<boolean> {
  try {
    const body = new URLSearchParams({
      auth_key: creds.token.trim(),
      id: baseId,
      channel: String(channel),
      turn: on ? "on" : "off",
    });
    if (timerSec) body.set("timer", String(timerSec));

    const res = await fetch(`${normalizeShellyServer(creds.baseUrl)}/device/relay/control`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { isok?: boolean };
    return data.isok === true;
  } catch {
    return false;
  }
}

/**
 * Lokal bevorzugen, sonst Cloud. Vercel erreicht 192.168.x nicht – dort greift
 * immer der Cloud-Pfad, sofern eine Shelly-Verbindung hinterlegt ist.
 */
export async function shellySetRelay(
  target: { ipAddress: string | null; baseId: string | null },
  cloud: ShellyCloudCreds | null,
  channel: number,
  on: boolean,
  timerSec?: number,
): Promise<boolean> {
  if (target.ipAddress) {
    if (await shellySetRelayLocal(target.ipAddress, channel, on, timerSec)) return true;
  }
  if (cloud && target.baseId) {
    return shellySetRelayCloud(cloud, target.baseId, channel, on, timerSec);
  }
  return false;
}
