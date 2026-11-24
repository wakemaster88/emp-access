import { isIP } from "node:net";
import { CONFIG_ID_RE } from "./utils";
import type { Cam, Config, DoorbirdConfig, Settings, Widget } from "./types";

/**
 * Zusätzliche Prüfungen beim Speichern über die Admin-API.
 *
 * Das Zod-Schema bleibt beim Lesen der config.json großzügig, damit
 * bestehende Konfigurationen weiter laden. Hier geprüft wird nur, was eine
 * Anfrage neu setzt oder ändert: neue IDs, geänderte Adressen und URLs.
 * Unveränderte Bestandswerte bleiben erlaubt.
 */

export const ID_ERROR = "ID: nur Kleinbuchstaben, Ziffern, - und _ (höchstens 40 Zeichen)";

export function isConfigId(id: string): boolean {
  return CONFIG_ID_RE.test(id);
}

/**
 * IPv4-Adresse ohne Port und ohne Leerraum am Rand. Die Adresse wird ohne
 * Klammern in http- und rtsp-URLs eingesetzt, deshalb kein IPv6.
 */
export function isIpAddress(value: string): boolean {
  return value === value.trim() && isIP(value) === 4;
}

/** Absolute http(s)-URL ohne Leerraum am Rand. */
export function isHttpUrl(value: string): boolean {
  if (value !== value.trim()) return false;
  try {
    const u = new URL(value);
    return (u.protocol === "http:" || u.protocol === "https:") && !!u.hostname;
  } catch {
    return false;
  }
}

/** Kamera: neue ID und geänderte IP prüfen. `existing` = gespeicherter Stand. */
export function camWriteErrors(cam: Cam, existing: Cam | null): string[] {
  const errors: string[] = [];
  if (!existing && !isConfigId(cam.id)) errors.push(ID_ERROR);
  if ((!existing || existing.ip !== cam.ip) && !isIpAddress(cam.ip)) {
    errors.push("IP: bitte eine IPv4-Adresse eintragen (z. B. 192.168.1.10)");
  }
  return errors;
}

/** Widget: nur eine neue ID prüfen (beim Bearbeiten bleibt die ID gleich). */
export function widgetWriteErrors(widget: Widget, existing: Widget | null): string[] {
  if (!existing && !isConfigId(widget.id)) return [ID_ERROR];
  return [];
}

// Teilobjekte können bei alten Configs fehlen (Zod-Default `{}`), daher
// überall optionaler Zugriff; fehlend gilt als „nicht gesetzt“.

/** DoorBird: geänderte IP prüfen; leer bleibt erlaubt. */
export function doorbirdWriteErrors(db: DoorbirdConfig, current: DoorbirdConfig): string[] {
  const ip = db?.ip;
  if (!ip || ip === current?.ip) return [];
  return isIpAddress(ip) ? [] : ["DoorBird-IP: bitte eine IPv4-Adresse eintragen (z. B. 192.168.1.30)"];
}

/** Einstellungen: geänderte go2rtc- und emp-access-URL prüfen; go2rtc leer bleibt erlaubt. */
export function settingsWriteErrors(s: Settings, current: Settings): string[] {
  const errors: string[] = [];
  const go2rtcUrl = s?.go2rtcUrl;
  if (go2rtcUrl && go2rtcUrl !== current?.go2rtcUrl && !isHttpUrl(go2rtcUrl)) {
    errors.push("go2rtc-URL: bitte eine http(s)-Adresse eintragen");
  }
  const baseUrl = s?.empAccess?.baseUrl;
  if (baseUrl !== undefined && baseUrl !== current?.empAccess?.baseUrl && !isHttpUrl(baseUrl)) {
    errors.push("emp-access-URL: bitte eine http(s)-Adresse eintragen");
  }
  return errors;
}

/** Komplette Config (PUT /api/config): alle Teilprüfungen gegen den gespeicherten Stand. */
export function configWriteErrors(next: Config, current: Config): string[] {
  const errors: string[] = [];
  for (const cam of next.cams ?? []) {
    errors.push(...camWriteErrors(cam, current.cams?.find((c) => c.id === cam.id) ?? null));
  }
  for (const w of next.widgets ?? []) {
    errors.push(...widgetWriteErrors(w, current.widgets?.find((x) => x.id === w.id) ?? null));
  }
  errors.push(...doorbirdWriteErrors(next.doorbird, current.doorbird));
  errors.push(...settingsWriteErrors(next.settings, current.settings));
  return errors;
}
