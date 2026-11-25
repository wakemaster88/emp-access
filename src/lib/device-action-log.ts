/**
 * Protokoll der Geraete-Schaltungen (Tabelle DeviceActionLog): wer wann ein
 * Geraet geschaltet, sein Token geaendert oder es geloescht hat.
 *
 * Das Schreiben laeuft neben der Aktion her: `recordDeviceAction` wirft nie,
 * wartet nicht auf die Datenbank und haelt damit keine Tuer auf. Innerhalb
 * einer Anfrage wird die Schreib-Promise an `after()` uebergeben, damit die
 * Plattform die Funktion bis zum Ende des Schreibens am Leben haelt.
 */
import { after } from "next/server";
import { prisma } from "@/lib/prisma";

/** "admin" = angemeldeter Benutzer mit Sitzung, gleich welche Rolle. */
export type DeviceActionSource =
  | "admin"
  | "kiosk"
  | "monitor"
  | "mobil"
  | "verein"
  | "skill"
  | "regel"
  | "mcp"
  | "unbekannt";

/**
 * "ok" heisst: Befehl gesendet bzw. Auftrag erteilt. Bei Geraeten, die ihren
 * Auftrag selbst abholen (Pi, Hub), sagt es nichts darueber, ob er ausgefuehrt
 * wurde.
 */
export type DeviceActionResult = "ok" | "fehler" | "abgelehnt";

/** Wer die Aktion ausgeloest hat. */
export type DeviceActionBy = {
  source: DeviceActionSource;
  /** Admin.id eines angemeldeten Benutzers. */
  actorId?: number | null;
  /** Kennung der Quelle (Monitor-ID, Regel-ID, "ticket:<id>" ...), nie ein Token. */
  actorLabel?: string | null;
};

export type DeviceActionEntry = {
  accountId: number;
  deviceId: number;
  deviceName?: string | null;
  action: string;
  result: DeviceActionResult;
  by?: DeviceActionBy;
};

export type DeviceActionRow = {
  accountId: number;
  deviceId: number;
  deviceName: string;
  action: string;
  result: DeviceActionResult;
  source: DeviceActionSource;
  actorId: number | null;
  actorLabel: string | null;
};

const NAME_MAX = 120;
const ACTION_MAX = 40;
const LABEL_MAX = 120;

/** Zeile fuer die Tabelle: Laengen begrenzt, fehlende Angaben aufgefuellt. */
export function deviceActionRow(entry: DeviceActionEntry): DeviceActionRow {
  const actorId = entry.by?.actorId;
  const name = entry.deviceName?.trim();
  const label = entry.by?.actorLabel?.trim();
  return {
    accountId: entry.accountId,
    deviceId: entry.deviceId,
    deviceName: (name || `#${entry.deviceId}`).slice(0, NAME_MAX),
    action: entry.action.slice(0, ACTION_MAX),
    result: entry.result,
    source: entry.by?.source ?? "unbekannt",
    actorId: typeof actorId === "number" && Number.isInteger(actorId) && actorId > 0 ? actorId : null,
    actorLabel: label ? label.slice(0, LABEL_MAX) : null,
  };
}

/**
 * Ergebnis einer Schaltung fuers Protokoll. Bei Geraeten, die ihren Auftrag
 * selbst abholen (Pi), gibt es kein `sent`: dort zaehlt nur ein Fehlertext.
 */
export function deviceActionOutcome(
  sendsRemoteCommand: boolean,
  res: { sent: boolean; error?: string },
): DeviceActionResult {
  if (res.error) return "fehler";
  if (sendsRemoteCommand && !res.sent) return "fehler";
  return "ok";
}

type Writer = (row: DeviceActionRow) => Promise<unknown>;
type Keeper = (task: Promise<unknown>) => void;

const writeRow: Writer = (row) => prisma.deviceActionLog.create({ data: row, select: { id: true } });

/**
 * Schreibt einen Protokoll-Eintrag, ohne darauf zu warten. Wirft nie; ein
 * Fehler beim Schreiben landet nur im Server-Log.
 */
export function recordDeviceAction(
  entry: DeviceActionEntry,
  write: Writer = writeRow,
  keep: Keeper = after,
): void {
  let task: Promise<unknown>;
  try {
    task = Promise.resolve(write(deviceActionRow(entry))).catch((err) => {
      console.error("[device-action-log] schreiben fehlgeschlagen:", err);
    });
  } catch (err) {
    console.error("[device-action-log] schreiben fehlgeschlagen:", err);
    return;
  }
  try {
    keep(task);
  } catch {
    /* Ausserhalb einer Anfrage (Skript): die Promise laeuft ohne after() weiter. */
  }
}
