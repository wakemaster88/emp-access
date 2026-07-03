import { prisma } from "@/lib/prisma";

/** Quelle eines Bewässerungs-Laufs (Anzeige + Filter in der Statistik). */
export type IrrigationRunSource = "schedule" | "schedule_now" | "manual";

const ASSUMED_FLOW_L_PER_HOUR = 720;

/**
 * Protokolliert einen erfolgreichen Ventil-Lauf. Best effort – Fehler blockieren
 * die Bewässerung nicht (wichtig fuer Cron und manuelle Aktionen).
 */
export async function logIrrigationRun(params: {
  accountId: number;
  deviceId: number;
  durationMinutes: number;
  source: IrrigationRunSource;
  scheduleId?: number | null;
  /** Durchfluss der Zone in Liter/Stunde (wie an der Pumpe angezeigt). */
  flowLph?: number | null;
  startedAt?: Date;
}): Promise<void> {
  const minutes = Math.max(1, Math.round(params.durationMinutes));
  const flowLph = params.flowLph && params.flowLph > 0 ? params.flowLph : ASSUMED_FLOW_L_PER_HOUR;
  try {
    await prisma.irrigationRun.create({
      data: {
        accountId: params.accountId,
        deviceId: params.deviceId,
        scheduleId: params.scheduleId ?? null,
        startedAt: params.startedAt ?? new Date(),
        durationMinutes: minutes,
        source: params.source,
        litersEstimate: Math.round((flowLph / 60) * minutes),
      },
    });
  } catch {
    /* Logging optional */
  }
}
