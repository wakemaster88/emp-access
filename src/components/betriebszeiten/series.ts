/**
 * Eine Farbe je Bereich aus der Diagramm-Reihe (docs/design-regeln.md, Abschnitt 15):
 * die Bereiche sind Datenreihen, keine Zustände. Bis sieben Profile wiederholt sich
 * keine Farbe; danach bleiben Name und Reihenfolge eindeutig. Index = Reihenfolge
 * der Profile auf der Seite (Kalender, Profilkarten, Abgleich).
 */
export const SERIES = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5", "bg-chart-6", "bg-chart-7"];

export function seriesColor(index: number): string {
  return SERIES[index % SERIES.length];
}
