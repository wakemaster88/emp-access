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
  /** Unterprofil von (z. B. Bahnmiete A unter Wasserski). */
  parentId: number | null;
  /** Belegte Anlagen für die Überschneidungsprüfung. */
  facilities: string[];
  /** Feste anny-Ressource für den Abgleich. */
  annyResourceId: string | null;
  /** Geteilte Zeit mit anderen Buchungsangeboten auf derselben Anlage. */
  sharedTime: boolean;
  roomCount: number;
  /** Räume, die diesem Profil folgen (für die Profilkarte). */
  roomNames: string[];
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
