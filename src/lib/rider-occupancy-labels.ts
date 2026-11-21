/**
 * Stufen und Vorgaben der Auslastung am Lift ohne Datenbank-Zugriff, damit
 * Client-Komponenten (Einstellungskarte) sie laden können, ohne Prisma/pg in
 * den Browser-Bundle zu ziehen (Build brach daran ab, 21.11.2026).
 */
export interface OccupancyThresholds {
  /** Ab so vielen Fahrern „Gut besucht“. */
  mediumFrom: number;
  /** Ab so vielen Fahrern „Viel los“. */
  highFrom: number;
}

export const DEFAULT_OCCUPANCY_THRESHOLDS: OccupancyThresholds = { mediumFrom: 10, highFrom: 25 };

export type OccupancyLevel = "none" | "low" | "medium" | "high";

export const OCCUPANCY_LABEL: Record<OccupancyLevel, string> = {
  none: "Gerade ruhig",
  low: "Freie Bahn",
  medium: "Gut besucht",
  high: "Viel los",
};
