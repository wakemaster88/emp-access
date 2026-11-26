/**
 * Kamerasuche per Anmeldung (cameras.ts findCameraByApi): Welche Adressen aus
 * dem letzten Netzwerk-Scan fragt der Hub mit den Zugangsdaten einer
 * vermissten Kamera nach ihrer MAC? Regeln ohne Netz.
 *
 * Nur Adressen im zuletzt bekannten Subnetz der Kamera und im Kamera-Netz,
 * nie eine Adresse, die einem anderen eingerichteten Geraet gehoert, und nur
 * Geraete, die eine Kamera sein koennen. Wie oft eine Adresse gefragt werden
 * darf, entscheidet auth-latch.ts (probeAllowed).
 */

import type { AuthOutcome } from "./auth-latch.js";

/** Was der Hub aus dem Scan braucht (ScannedDevice in scanner.ts). */
export interface ProbeScanDevice {
  ip: string;
  mac: string | null;
  vendor: string | null;
  openPorts: number[];
  /** Gesetzt, wenn das Geraet ein Shelly ist. */
  shelly?: unknown;
}

function ipToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) return null;
    n = n * 256 + Number(p);
  }
  return n >>> 0;
}

function parseCidr(cidr: string): { base: number; mask: number } | null {
  const m = cidr.trim().match(/^([\d.]+)\/(\d{1,2})$/);
  if (!m) return null;
  const ip = ipToInt(m[1]);
  const len = Number(m[2]);
  if (ip === null || len < 8 || len > 30) return null;
  const mask = (0xffffffff << (32 - len)) >>> 0;
  return { base: (ip & mask) >>> 0, mask };
}

function inCidr(ip: string, net: { base: number; mask: number } | null): boolean {
  const n = ipToInt(ip);
  return n !== null && net !== null && ((n & net.mask) >>> 0) === net.base;
}

/**
 * Kamera-Netz aus der Einstellung der Netze (HUB_VLANS, netmap.ts
 * configuredVlans): das erste Netz, dessen Name es als Kamera-Netz zeigt.
 * null, wenn keines so heisst; dann fragt die Suche nur im letzten Subnetz.
 */
export function cameraNetOf(vlans: Array<{ name: string; cidr: string }>): string | null {
  return vlans.find((v) => /kamera|camera|cctv|video/i.test(v.name))?.cidr ?? null;
}

/**
 * Adressen, die die Suche fragen darf, zuerst die im letzten Subnetz.
 * `vergeben`: Adressen aller eingerichteten Geraete (Kameras, DoorBirds,
 * Geraete der Raeume). `gesuchteMac`: MAC der vermissten Kamera; ein Geraet
 * mit bekannter anderer MAC ist sie nicht. `letztesSubnetz` und `kameraNetz`
 * als CIDR, null = unbekannt.
 */
export function apiProbeCandidates(
  scan: ProbeScanDevice[],
  vergeben: ReadonlySet<string>,
  gesuchteMac: string,
  letztesSubnetz: string | null,
  kameraNetz: string | null
): string[] {
  const last = letztesSubnetz ? parseCidr(letztesSubnetz) : null;
  const cams = kameraNetz ? parseCidr(kameraNetz) : null;
  const wanted = gesuchteMac.toUpperCase();
  const seen = new Set<string>();
  const first: string[] = [];
  const then: string[] = [];
  for (const d of scan) {
    if (seen.has(d.ip) || vergeben.has(d.ip)) continue;
    if (d.mac !== null && d.mac.toUpperCase() !== wanted) continue;
    if (d.shelly) continue;
    if (!(/reolink/i.test(d.vendor ?? "") || d.openPorts.includes(554))) continue;
    const inLast = inCidr(d.ip, last);
    if (!inLast && !inCidr(d.ip, cams)) continue;
    seen.add(d.ip);
    (inLast ? first : then).push(d.ip);
  }
  return [...first, ...then];
}

/**
 * Ausgang der Anmeldung an einer fremden Adresse (Fehler aus cgi/ensureLogin
 * in cameras.ts): HTTP 401/403 oder eine Reolink-Antwort „Login fehlgeschlagen“
 * (rspCode -7, oder der Text nennt Login, Benutzer oder Passwort) ist eine
 * Ablehnung. Eine andere HTTP- oder API-Antwort ist kein Nein zu den
 * Zugangsdaten; ein Netzfehler oder Zeitlimit ist keine Antwort.
 */
export function probeLoginOutcome(err: { name?: string; message?: string }): AuthOutcome {
  const msg = err.message ?? "";
  const http = msg.match(/^HTTP (\d{3})$/);
  if (http) return http[1] === "401" || http[1] === "403" ? "abgelehnt" : "anders";
  if (/^Login fehlgeschlagen:/.test(msg)) {
    return /\(rspCode -7\)$/.test(msg) || /login failed|login error|password|passwd|user/i.test(msg) ? "abgelehnt" : "anders";
  }
  if (err.name === "SyntaxError" || /^Login ohne Token/.test(msg)) return "anders";
  return "keine";
}
