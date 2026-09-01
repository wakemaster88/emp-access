import type { ExceptionSpec, PeriodSpec, SeasonSpec } from "@/lib/operating-hours";

export interface SeasonRow extends SeasonSpec {
  /** Nur zum Wiedererkennen in der Liste; die API ersetzt Saisons vollständig. */
  key: string;
}

export interface ScheduleRow {
  id: number;
  name: string;
  description: string | null;
  isDefault: boolean;
  sortOrder: number;
  roomCount: number;
  seasons: SeasonSpec[];
  exceptions: ExceptionSpec[];
}

export interface BetriebszeitenData {
  schedules: ScheduleRow[];
  /** Zeitzone des Mandanten, für die Anzeige des aktuellen Zustands. */
  timezone: string;
  /** Serverzeit des Renderns, damit Client und Server dasselbe „jetzt“ nutzen. */
  renderedAt: string;
  /** Räume ohne Betriebszeit – die gelten als dauerhaft verfügbar. */
  roomsWithoutSchedule: number;
  readonly: boolean;
}

export type { ExceptionSpec, PeriodSpec, SeasonSpec };
