/**
 * Soundweb London (BSS): reine Helfer ohne Server-Importe, damit sie in
 * Client-Komponenten, API-Routen und Tests gleich funktionieren.
 *
 * Grundlage ist das London-DI-Protokoll (Soundweb London Interface Kit,
 * Rev. 2.7): Jede State Variable (SV) eines Objekts ist ein 32-Bit-Wert, dessen
 * Kodierung von der Art des Reglers abhängt. Was der Hub verschickt und
 * empfängt, sind diese Rohwerte; hier stehen die Umrechnungen für die Anzeige.
 */
import type { SoundwebControlKind } from "@prisma/client";

export const SOUNDWEB_DEFAULT_PORT = 1023;
/** Virtual Device aller Audio-Objekte im Design. */
export const SOUNDWEB_AUDIO_VIRTUAL_DEVICE = 0x03;

export const SOUNDWEB_KIND_LABELS: Record<SoundwebControlKind, string> = {
  GAIN: "Pegel (dB)",
  MUTE: "Stummschaltung",
  PERCENT: "Regler (Prozent)",
  SELECT: "Auswahl",
  PRESET: "Preset",
};

/**
 * Gilt ein Prozessor als verbunden? Der Hub meldet den Zustand jede Minute;
 * bleibt die Meldung länger aus, ist der Hub weg – dann sagt „verbunden“
 * in der Datenbank nichts mehr.
 */
export const SOUNDWEB_STALE_AFTER_MS = 3 * 60_000;

export function soundwebOnline(device: {
  connected: boolean;
  lastSeenAt: Date | string | null;
}): boolean {
  if (!device.connected || !device.lastSeenAt) return false;
  const seen = new Date(device.lastSeenAt).getTime();
  return Number.isFinite(seen) && Date.now() - seen < SOUNDWEB_STALE_AFTER_MS;
}

/* ---------------------------------------------------------------------------
 * Gain-Law: linear zwischen -10 und +10 dB, darunter logarithmisch
 * ------------------------------------------------------------------------- */

/** Rohwert bei -10 dB – ab hier abwärts gilt der logarithmische Teil. */
const GAIN_KNEE_RAW = -100_000;
const GAIN_LINEAR_SCALE = 10_000;
const GAIN_LOG_SCALE = 200_000;
/** Unterhalb davon zeigt ein Fader in Audio Architect nur noch „-inf“. */
export const GAIN_NEG_INF_DB = -80;

export function gainDbToRaw(db: number): number {
  if (!Number.isFinite(db)) return GAIN_KNEE_RAW;
  if (db >= -10) return Math.round(db * GAIN_LINEAR_SCALE);
  return Math.round(-Math.log10(Math.abs(db / 10)) * GAIN_LOG_SCALE + GAIN_KNEE_RAW);
}

export function gainRawToDb(raw: number): number {
  if (raw >= GAIN_KNEE_RAW) return raw / GAIN_LINEAR_SCALE;
  return -10 * Math.pow(10, Math.abs(raw - GAIN_KNEE_RAW) / GAIN_LOG_SCALE);
}

/* ---------------------------------------------------------------------------
 * Prozent: 0–100 % mal 65536, damit Nachkommastellen mitgehen
 * ------------------------------------------------------------------------- */

const PERCENT_SCALE = 65_536;

export function percentToRaw(percent: number): number {
  const clamped = Math.min(100, Math.max(0, percent));
  return Math.round(clamped * PERCENT_SCALE);
}

export function rawToPercent(raw: number): number {
  return raw / PERCENT_SCALE;
}

/* ---------------------------------------------------------------------------
 * Adressen
 * ------------------------------------------------------------------------- */

export interface HiqnetAddressInput {
  /** null = nicht angegeben, der Node des Geräts gilt. */
  node: number | null;
  virtualDevice: number;
  objectId: number;
  /** Nur gesetzt, wenn die Eingabe die SV gleich mit enthielt. */
  stateVariable: number | null;
}

function parseHexOrDecimal(part: string): number | null {
  const t = part.trim();
  if (!t) return null;
  if (/^0x[0-9a-f]+$/i.test(t)) return parseInt(t.slice(2), 16);
  if (/^[0-9]+$/.test(t)) return Number(t);
  // Nackte Hex-Zahl mit Buchstaben (z. B. "1F") – ohne Buchstaben wäre sie
  // schon als Dezimalzahl durch.
  if (/^[0-9a-f]+$/i.test(t)) return parseInt(t, 16);
  return null;
}

/**
 * HiQnet-Adresse eines Objekts aus dem, was Audio Architect anzeigt.
 *
 * Akzeptiert die volle Adresse `0xNNNNvvoooooo` (12 Hex-Stellen: Node,
 * Virtual Device, Objekt), wahlweise mit angehängter SV (16 Stellen), nur die
 * Objektadresse (6 Stellen, dann Node des Geräts und Virtual Device 0x03) oder
 * durch Komma bzw. Leerzeichen getrennte Teile `Node, VD, Objekt[, SV]` in Hex
 * oder Dezimal. Liefert eine Fehlermeldung statt zu raten, wenn nichts passt.
 */
export function parseHiqnetAddress(input: string): HiqnetAddressInput | { error: string } {
  const raw = input.trim();
  if (!raw) return { error: "HiQnet-Adresse fehlt" };

  const parts = raw.split(/[,\s;]+/).filter(Boolean);
  if (parts.length === 1) {
    const hex = parts[0].replace(/^0x/i, "");
    if (!/^[0-9a-f]+$/i.test(hex)) return { error: "HiQnet-Adresse ist keine Hex-Zahl" };
    if (hex.length === 6) {
      return {
        node: null,
        virtualDevice: SOUNDWEB_AUDIO_VIRTUAL_DEVICE,
        objectId: parseInt(hex, 16),
        stateVariable: null,
      };
    }
    if (hex.length === 12 || hex.length === 16) {
      return {
        node: parseInt(hex.slice(0, 4), 16),
        virtualDevice: parseInt(hex.slice(4, 6), 16),
        objectId: parseInt(hex.slice(6, 12), 16),
        stateVariable: hex.length === 16 ? parseInt(hex.slice(12, 16), 16) : null,
      };
    }
    return {
      error:
        "HiQnet-Adresse braucht 12 Hex-Stellen (Node, Virtual Device, Objekt), z. B. 0x000103000100",
    };
  }

  if (parts.length === 3 || parts.length === 4) {
    const numbers = parts.map(parseHexOrDecimal);
    if (numbers.some((n) => n === null)) return { error: "HiQnet-Adresse enthält einen ungültigen Teil" };
    const [node, virtualDevice, objectId, stateVariable] = numbers as number[];
    return { node, virtualDevice, objectId, stateVariable: stateVariable ?? null };
  }

  return { error: "HiQnet-Adresse: entweder eine Hex-Adresse oder Node, VD, Objekt" };
}

/** SV-ID, in London Architect dezimal, in Audio Architect gern als 0x…. */
export function parseStateVariable(input: string | number): number | { error: string } {
  if (typeof input === "number") {
    return Number.isInteger(input) && input >= 0 && input <= 0xffff
      ? input
      : { error: "State Variable muss zwischen 0 und 65535 liegen" };
  }
  const n = parseHexOrDecimal(input);
  if (n === null || !Number.isInteger(n) || n < 0 || n > 0xffff) {
    return { error: "State Variable muss eine Zahl zwischen 0 und 65535 sein" };
  }
  return n;
}

export function formatHiqnetAddress(node: number, virtualDevice: number, objectId: number): string {
  return (
    "0x" +
    node.toString(16).padStart(4, "0") +
    virtualDevice.toString(16).padStart(2, "0") +
    objectId.toString(16).padStart(6, "0")
  ).toUpperCase().replace(/^0X/, "0x");
}

export function formatNode(node: number): string {
  return `0x${node.toString(16).padStart(4, "0").toUpperCase()}`;
}

/* ---------------------------------------------------------------------------
 * Anzeige und Befehle
 * ------------------------------------------------------------------------- */

export interface SoundwebSelectOption {
  value: number;
  label: string;
}

/** Auswahlwerte aus dem JSON der Datenbank – fremde Formen fallen leise raus. */
export function parseSelectOptions(raw: unknown): SoundwebSelectOption[] {
  if (!Array.isArray(raw)) return [];
  const out: SoundwebSelectOption[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const value = Number((item as { value?: unknown }).value);
    const label = String((item as { label?: unknown }).label ?? "").trim();
    if (!Number.isInteger(value)) continue;
    out.push({ value, label: label || String(value) });
  }
  return out;
}

export interface SoundwebControlShape {
  kind: SoundwebControlKind;
  minDb: number;
  maxDb: number;
  options: unknown;
}

/** Pegel für die Anzeige: „−∞“ am unteren Anschlag, sonst auf halbe dB gerundet. */
export function formatGainDb(db: number, minDb: number): string {
  if (db <= minDb || db <= GAIN_NEG_INF_DB) return "−∞ dB";
  const rounded = Math.round(db * 2) / 2;
  const text = rounded.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${rounded > 0 ? "+" : ""}${text} dB`;
}

/** Ist-Wert eines Reglers als Klartext; null, wenn noch keiner gemeldet wurde. */
export function formatControlValue(control: SoundwebControlShape, raw: number | null): string | null {
  if (raw === null) return null;
  switch (control.kind) {
    case "GAIN":
      return formatGainDb(gainRawToDb(raw), control.minDb);
    case "MUTE":
      return raw !== 0 ? "Stumm" : "An";
    case "PERCENT":
      return `${Math.round(rawToPercent(raw))} %`;
    case "SELECT": {
      const option = parseSelectOptions(control.options).find((o) => o.value === raw);
      return option ? option.label : `Wert ${raw}`;
    }
    case "PRESET":
      return null;
  }
}

/** Was der Hub für einen Sollwert bekommt: Rohwert der SV oder Prozent. */
export type SoundwebSetPayload =
  | { raw: number }
  | { percent: number }
  | { preset: true };

/**
 * Sollwert aus der Oberfläche in das Feld für den Hub übersetzen. GAIN kommt
 * in dB, MUTE als Wahrheitswert, PERCENT in Prozent, SELECT als Auswahlwert.
 * Liefert eine Fehlermeldung, wenn der Wert nicht zur Art passt.
 */
export function soundwebSetPayload(
  control: SoundwebControlShape,
  value: unknown
): SoundwebSetPayload | { error: string } {
  switch (control.kind) {
    case "PRESET":
      return { preset: true };
    case "MUTE": {
      if (typeof value === "boolean") return { raw: value ? 1 : 0 };
      if (value === 0 || value === 1) return { raw: value };
      return { error: "Stummschaltung braucht an oder aus" };
    }
    case "GAIN": {
      const db = Number(value);
      if (!Number.isFinite(db)) return { error: "Pegel in dB fehlt" };
      const clamped = Math.min(control.maxDb, Math.max(control.minDb, db));
      return { raw: gainDbToRaw(clamped) };
    }
    case "PERCENT": {
      const percent = Number(value);
      if (!Number.isFinite(percent)) return { error: "Prozentwert fehlt" };
      return { percent: Math.min(100, Math.max(0, percent)) };
    }
    case "SELECT": {
      const n = Number(value);
      if (!Number.isInteger(n)) return { error: "Auswahlwert fehlt" };
      const options = parseSelectOptions(control.options);
      if (options.length > 0 && !options.some((o) => o.value === n)) {
        return { error: "Auswahlwert steht nicht in der Liste" };
      }
      return { raw: n };
    }
  }
}
