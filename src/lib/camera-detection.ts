import { Prisma } from "@prisma/client";

/**
 * Fahrzeug- und Halteverbot-Einstellungen einer Kamera pruefen. Gemeinsam fuer
 * die Web-UI (PUT /api/cameras/[id]) und das Hub-Dashboard
 * (PATCH /api/hub/cameras/[id]/detection).
 */

export type ZonePoint = [number, number];

/**
 * Polygon pruefen: 3 bis 32 Punkte, normiert 0..1. Ein leeres Array bedeutet
 * „keine Zone“ und wird zu null.
 */
export function parseZoneInput(value: unknown): ZonePoint[] | null | "invalid" {
  if (value === null || (Array.isArray(value) && value.length === 0)) return null;
  const pts = Array.isArray(value) ? value : null;
  const ok =
    pts &&
    pts.length >= 3 &&
    pts.length <= 32 &&
    pts.every(
      (p: unknown) =>
        Array.isArray(p) &&
        p.length === 2 &&
        p.every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1)
    );
  if (!ok) return "invalid";
  return pts.map((p: number[]) => [
    Math.round(p[0] * 10000) / 10000,
    Math.round(p[1] * 10000) / 10000,
  ]);
}

export interface DetectionSettings {
  vehicleDetection: boolean;
  vehicleMinArea: number | null;
  vehicleZone: Prisma.JsonValue | null;
  noParkDetection: boolean;
  noParkZone: Prisma.JsonValue | null;
  noParkMinutes: number | null;
  deliveryMode: string | null;
  deliveryFrom: string | null;
  deliveryTo: string | null;
}

const DELIVERY_MODES = ["NOTIFY", "OPEN"];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Bestehende Werte mit den Feldern aus `body` zusammenfuehren und pruefen. */
export function mergeDetectionSettings(
  existing: DetectionSettings,
  body: Record<string, unknown>
): { settings: DetectionSettings } | { error: string } {
  // Mindestgroesse als Anteil 0..0.5 (null = Hub-Standard).
  let vehicleMinArea = existing.vehicleMinArea;
  if (body.vehicleMinArea !== undefined) {
    if (body.vehicleMinArea === null || body.vehicleMinArea === "") vehicleMinArea = null;
    else {
      const n = Number(body.vehicleMinArea);
      if (!Number.isFinite(n) || n < 0 || n > 0.5) {
        return { error: "Mindestgröße muss zwischen 0 und 50 % liegen" };
      }
      vehicleMinArea = n;
    }
  }
  let vehicleZone = existing.vehicleZone;
  if (body.vehicleZone !== undefined) {
    const parsed = parseZoneInput(body.vehicleZone);
    if (parsed === "invalid") {
      return { error: "Einfahrtszone braucht 3 bis 32 Punkte mit Werten zwischen 0 und 1" };
    }
    vehicleZone = parsed;
  }

  // Halteverbot: Ohne Fläche gibt es nichts zu prüfen.
  let noParkZone = existing.noParkZone;
  if (body.noParkZone !== undefined) {
    const parsed = parseZoneInput(body.noParkZone);
    if (parsed === "invalid") {
      return { error: "Halteverbot-Fläche braucht 3 bis 32 Punkte mit Werten zwischen 0 und 1" };
    }
    noParkZone = parsed;
  }
  let noParkMinutes = existing.noParkMinutes;
  if (body.noParkMinutes !== undefined) {
    if (body.noParkMinutes === null || body.noParkMinutes === "") noParkMinutes = null;
    else {
      const n = Number(body.noParkMinutes);
      // Unter einer Viertelminute liegt die Standzeit im Takt der Prüfung.
      if (!Number.isFinite(n) || n < 0.25 || n > 240) {
        return { error: "Standzeit muss zwischen 0,25 und 240 Minuten liegen" };
      }
      noParkMinutes = n;
    }
  }
  const noParkDetection =
    typeof body.noParkDetection === "boolean" ? body.noParkDetection : existing.noParkDetection;
  if (noParkDetection && !noParkZone) {
    return { error: "Halteverbot braucht eine Fläche auf dem Kamerabild" };
  }
  const vehicleDetection =
    typeof body.vehicleDetection === "boolean" ? body.vehicleDetection : existing.vehicleDetection;

  // Lieferdienste: Aus / nur melden / Tor oeffnen, Zeitfenster HH:mm.
  let deliveryMode = existing.deliveryMode;
  if (body.deliveryMode !== undefined) {
    if (body.deliveryMode === null || body.deliveryMode === "") deliveryMode = null;
    else if (typeof body.deliveryMode === "string" && DELIVERY_MODES.includes(body.deliveryMode)) {
      deliveryMode = body.deliveryMode;
    } else return { error: "Lieferdienste: Modus muss Aus, Melden oder Öffnen sein" };
  }
  const time = (key: "deliveryFrom" | "deliveryTo"): string | null | { error: string } => {
    const v = body[key];
    if (v === undefined) return existing[key];
    if (v === null || v === "") return null;
    if (typeof v === "string" && HHMM.test(v)) return v;
    return { error: "Lieferdienste: Uhrzeit als HH:MM angeben" };
  };
  const deliveryFrom = time("deliveryFrom");
  if (deliveryFrom && typeof deliveryFrom === "object") return deliveryFrom;
  const deliveryTo = time("deliveryTo");
  if (deliveryTo && typeof deliveryTo === "object") return deliveryTo;
  if (deliveryMode && !vehicleDetection) {
    return { error: "Lieferdienste brauchen die Fahrzeugerkennung" };
  }

  return {
    settings: {
      vehicleDetection,
      vehicleMinArea,
      vehicleZone,
      noParkDetection,
      noParkZone,
      noParkMinutes,
      deliveryMode,
      deliveryFrom,
      deliveryTo,
    },
  };
}

/** Prisma-Daten fuer das Update (JSON-Spalte auf NULL geht nur ueber DbNull). */
export function detectionUpdateData(s: DetectionSettings) {
  return {
    vehicleDetection: s.vehicleDetection,
    vehicleMinArea: s.vehicleMinArea,
    vehicleZone: s.vehicleZone === null ? Prisma.DbNull : (s.vehicleZone as Prisma.InputJsonValue),
    noParkDetection: s.noParkDetection,
    noParkZone: s.noParkZone === null ? Prisma.DbNull : (s.noParkZone as Prisma.InputJsonValue),
    noParkMinutes: s.noParkMinutes,
    deliveryMode: s.deliveryMode,
    deliveryFrom: s.deliveryFrom,
    deliveryTo: s.deliveryTo,
  };
}

export const DETECTION_SELECT = {
  vehicleDetection: true,
  vehicleMinArea: true,
  vehicleZone: true,
  noParkDetection: true,
  noParkZone: true,
  noParkMinutes: true,
  deliveryMode: true,
  deliveryFrom: true,
  deliveryTo: true,
} as const;
