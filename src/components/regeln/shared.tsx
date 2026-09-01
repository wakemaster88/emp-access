"use client";

/** Beschriftungen und Kurzfassungen für Regeln. */

import { deviceControls } from "@/lib/device-controls";
import { eventTypeLabel } from "@/components/raeume/shared";
import type { Rule, RuleAction, RuleTrigger } from "@/components/regeln/types";

export const TRIGGER_LABELS: Record<RuleTrigger, string> = {
  TIME: "Uhrzeit",
  OPENING: "Betriebsbeginn",
  CLOSING: "Betriebsende",
  SUNRISE: "Sonnenaufgang",
  SUNSET: "Sonnenuntergang",
  MOTION: "Bewegung",
  DEVICE_SWITCHED: "Gerät geschaltet",
  SCAN: "Zutritt am Leser",
  IDLE: "Ruhe im Raum",
};

/** Wie `TRIGGER_LABELS`, aber für Werte, die erst zur Laufzeit feststehen. */
export function triggerLabel(trigger: string): string {
  return TRIGGER_LABELS[trigger as RuleTrigger] ?? trigger;
}

/** Erklärt, was der Auslöser bedeutet – für die Auswahl im Dialog. */
export const TRIGGER_HINTS: Record<RuleTrigger, string> = {
  TIME: "Feste Uhrzeit, jeden gewählten Wochentag.",
  OPENING: "Wenn die zuständige Betriebszeit öffnet, wahlweise vorher oder nachher.",
  CLOSING: "Wenn die zuständige Betriebszeit schließt, wahlweise vorher oder nachher.",
  SUNRISE: "Sonnenaufgang am Standort des Betriebs.",
  SUNSET: "Sonnenuntergang am Standort des Betriebs.",
  MOTION: "Eine Kamera meldet Bewegung, eine Person oder ein Fahrzeug.",
  DEVICE_SWITCHED: "Ein Gerät wird über EMP geschaltet. Handschaltungen am Gerät zählen nicht.",
  SCAN: "Ein gewährter Zutritt an einem Leser.",
  IDLE: "Seit der eingestellten Dauer meldet keine Kamera des Raums Bewegung.",
};

export const OPERATING_LABELS: Record<string, string> = {
  ANY: "Betriebszeit egal",
  OPEN: "nur während der Betriebszeit",
  CLOSED: "nur außerhalb der Betriebszeit",
};

export const CHANNEL_LABELS: Record<string, string> = {
  TELEGRAM: "Telegram",
  PUSH: "Push",
  BOTH: "Telegram und Push",
};

export const TRIGGER_KIND_LABELS: Record<string, string> = {
  time: "Uhrzeit",
  opening: "Betriebsbeginn",
  closing: "Betriebsende",
  sunrise: "Sonnenaufgang",
  sunset: "Sonnenuntergang",
  motion: "Bewegung",
  device: "Gerät geschaltet",
  scan: "Zutritt",
  idle: "Ruhe im Raum",
  manual: "von Hand",
  // Aus der Zeit vor der Regel-Engine, taucht im übernommenen Verlauf auf.
  schedule: "Uhrzeit",
  camera: "Bewegung",
};

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

/** "Mo–Fr", "täglich" oder "Mo, Mi, Sa" – je nachdem, was kürzer trägt. */
export function weekdayLabel(mask: number): string {
  if (mask === 127) return "täglich";
  if (mask === 0) return "nie";
  if (mask === 31) return "Mo–Fr";
  if (mask === 96) return "Sa+So";
  return WEEKDAYS.filter((_, i) => ((mask >> i) & 1) === 1).join(", ");
}

/** "+15 Min." / "−1 Std." – Verschiebung gegenüber dem Bezugszeitpunkt. */
export function offsetLabel(minutes: number): string {
  if (minutes === 0) return "pünktlich";
  const sign = minutes > 0 ? "+" : "−";
  const abs = Math.abs(minutes);
  if (abs < 60) return `${sign}${abs} Min.`;
  const hours = Math.floor(abs / 60);
  const rest = abs % 60;
  return rest === 0 ? `${sign}${hours} Std.` : `${sign}${hours}:${String(rest).padStart(2, "0")} Std.`;
}

export function cooldownLabel(seconds: number): string {
  if (seconds <= 0) return "keine Sperrzeit";
  if (seconds < 60) return `${seconds} Sek. Sperrzeit`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} Min. Sperrzeit`;
  return `${Math.round(minutes / 60)} Std. Sperrzeit`;
}

/** Ein Satz, der den Auslöser der Regel beschreibt. */
export function describeTrigger(rule: Rule): string {
  switch (rule.trigger) {
    case "TIME":
      return `Um ${rule.timeOfDay ?? "–"} Uhr`;
    case "OPENING":
    case "CLOSING": {
      const base = rule.trigger === "OPENING" ? "Betriebsbeginn" : "Betriebsende";
      const which = rule.operatingSchedule?.name ?? rule.room?.name ?? "des Raums";
      return `${base} (${which}), ${offsetLabel(rule.offsetMinutes)}`;
    }
    case "SUNRISE":
    case "SUNSET": {
      const base = rule.trigger === "SUNRISE" ? "Sonnenaufgang" : "Sonnenuntergang";
      return `${base}, ${offsetLabel(rule.offsetMinutes)}`;
    }
    case "MOTION": {
      const what = rule.eventType ? eventTypeLabel(rule.eventType) : "Bewegung";
      const where = rule.camera?.name ?? (rule.room ? `jede Kamera in ${rule.room.name}` : "jede Kamera");
      return `${what} · ${where}`;
    }
    case "DEVICE_SWITCHED": {
      const what = rule.triggerDevice?.name ?? "Gerät";
      const action = rule.triggerAction ? deviceActionLabel(rule.triggerAction) : "beliebig geschaltet";
      return `${what} · ${action}`;
    }
    case "SCAN": {
      const where = rule.area?.name ?? "jeder Bereich";
      const dir =
        rule.scanDirection === "IN" ? "Eingang" : rule.scanDirection === "OUT" ? "Ausgang" : "beide Richtungen";
      return `Zutritt · ${where} · ${dir}`;
    }
    case "IDLE":
      return `${rule.idleMinutes ?? "–"} Min. ohne Bewegung`;
    default:
      return TRIGGER_LABELS[rule.trigger] ?? rule.trigger;
  }
}

/**
 * Beschriftung eines Schaltbefehls. Ohne Gerätekontext ist die Zuordnung nicht
 * eindeutig ("open" heißt bei einer Markise "Ausfahren"), deshalb greift die
 * allgemeine Fassung nur, wenn kein Gerät bekannt ist.
 */
export function deviceActionLabel(
  action: string,
  device?: { type: string; category: string | null } | null,
): string {
  if (device) {
    const match = deviceControls(device).find((c) => c.action === action);
    if (match) return match.label;
  }
  const generic: Record<string, string> = {
    open: "Einschalten",
    reset: "Ausschalten",
    close: "Schließen",
    stop: "Stopp",
    deactivate: "Abschließen",
    emergency: "NOT-AUF",
  };
  return generic[action] ?? action;
}

/** Kurzfassung einer einzelnen Aktion für die Regelkarte. */
export function describeAction(action: RuleAction): string {
  if (action.kind === "DEVICE") {
    const name = action.device?.name ?? "Gerät";
    const verb = action.deviceAction
      ? deviceActionLabel(action.deviceAction, action.device ? { type: action.device.type, category: null } : null)
      : "schalten";
    const timer = action.timerSeconds ? ` für ${action.timerSeconds} Sek.` : "";
    return `${name}: ${verb}${timer}`;
  }
  if (action.kind === "NOTIFY") {
    return `${CHANNEL_LABELS[action.channel ?? "PUSH"]}: ${action.message?.trim() || "Regelname als Text"}`;
  }
  const zone = action.audioZone?.name ?? "Zone";
  if (action.audioAnnouncement) return `${zone}: Durchsage „${action.audioAnnouncement.name}“`;
  if (action.audioPlaylist) return `${zone}: Playlist „${action.audioPlaylist.name}“`;
  return `${zone}: Wiedergabe stoppen`;
}
