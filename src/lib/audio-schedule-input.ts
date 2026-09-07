/**
 * Eingabepruefung fuer den Zeitpunkt eines Audio-Zeitplans. Liegt hier und
 * nicht in den Route-Dateien, weil beide (Anlegen und Aendern) dieselbe
 * Pruefung brauchen und `route.ts` nur HTTP-Handler exportieren darf.
 */

import type { AudioScheduleTrigger, RuleOperatingCondition } from "@prisma/client";
import { parseTimeOfDay } from "@/lib/audio-constants";
import type { TenantDb } from "@/lib/prisma";

export const scheduleResponseInclude = {
  announcement: { select: { id: true, name: true } },
  playlist: { select: { id: true, name: true } },
  operatingSchedule: { select: { id: true, name: true } },
};

export interface ScheduleTiming {
  trigger: AudioScheduleTrigger;
  timeOfDay: string | null;
  offsetMinutes: number;
  operatingScheduleId: number | null;
  operating: RuleOperatingCondition;
}

const TRIGGERS: AudioScheduleTrigger[] = ["TIME", "OPENING", "CLOSING"];
const CONDITIONS: RuleOperatingCondition[] = ["ANY", "OPEN", "CLOSED"];

/** Groesster Versatz gegenueber Betriebsbeginn/-ende: zwoelf Stunden. */
const MAX_OFFSET_MINUTES = 720;

/**
 * Zeitangaben aus dem Request-Body. `existing` liefert die Vorbelegung beim
 * Aendern; beim Anlegen ist es null und fehlende Felder bekommen Standardwerte.
 */
export async function parseScheduleTiming(
  db: TenantDb,
  accountId: number,
  body: Record<string, unknown>,
  existing: ScheduleTiming | null,
): Promise<ScheduleTiming | { error: string }> {
  const trigger =
    body.trigger === undefined
      ? (existing?.trigger ?? "TIME")
      : TRIGGERS.includes(body.trigger as AudioScheduleTrigger)
        ? (body.trigger as AudioScheduleTrigger)
        : null;
  if (!trigger) return { error: "Ungültiger Zeitbezug" };

  let timeOfDay: string | null = null;
  if (trigger === "TIME") {
    timeOfDay =
      body.timeOfDay === undefined ? (existing?.timeOfDay ?? null) : parseTimeOfDay(body.timeOfDay);
    if (!timeOfDay) return { error: "Ungültige Uhrzeit (HH:mm)" };
  }

  let offsetMinutes = 0;
  if (trigger !== "TIME") {
    const raw = body.offsetMinutes === undefined ? (existing?.offsetMinutes ?? 0) : Number(body.offsetMinutes);
    if (!Number.isInteger(raw) || Math.abs(raw) > MAX_OFFSET_MINUTES) {
      return { error: `Verschiebung muss zwischen −${MAX_OFFSET_MINUTES} und ${MAX_OFFSET_MINUTES} Minuten liegen` };
    }
    offsetMinutes = raw;
  }

  let operatingScheduleId: number | null = existing?.operatingScheduleId ?? null;
  if (body.operatingScheduleId !== undefined) {
    if (body.operatingScheduleId === null || body.operatingScheduleId === "") {
      operatingScheduleId = null;
    } else {
      const candidate = Number(body.operatingScheduleId);
      const schedule = Number.isInteger(candidate)
        ? await db.operatingSchedule.findFirst({
            where: { id: candidate, accountId },
            select: { id: true },
          })
        : null;
      if (!schedule) return { error: "Betriebszeit nicht gefunden" };
      operatingScheduleId = candidate;
    }
  }

  const operating =
    body.operating === undefined
      ? (existing?.operating ?? "ANY")
      : CONDITIONS.includes(body.operating as RuleOperatingCondition)
        ? (body.operating as RuleOperatingCondition)
        : null;
  if (!operating) return { error: "Ungültige Betriebszeit-Bedingung" };

  return { trigger, timeOfDay, offsetMinutes, operatingScheduleId, operating };
}
