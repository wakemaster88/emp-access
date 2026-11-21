/**
 * Stufen und Vorgaben der Strandbad-Auslastung ohne Datenbank-Zugriff, damit
 * Client-Komponenten (Einstellungskarte) sie laden können, ohne Prisma/pg in
 * den Browser-Bundle zu ziehen (Build brach daran ab, 21.11.2026).
 */
export interface BeachSettings {
  factor: number;
  mediumFrom: number;
  highFrom: number;
}

export const DEFAULT_BEACH_SETTINGS: BeachSettings = { factor: 3, mediumFrom: 600, highFrom: 1200 };

export type BeachLevel = "low" | "medium" | "high";

export const BEACH_LABEL: Record<BeachLevel, string> = {
  low: "Viel Platz",
  medium: "Gut besucht",
  high: "Viel los",
};
