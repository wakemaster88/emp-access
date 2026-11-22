/**
 * Feste Farben der Bereiche in den Dashboard-Diagrammen (docs/design-regeln.md,
 * Abschnitt 15: nur `--chart-*`). Die Farbe hängt an der Position des Bereichs
 * in der Antwort von `/api/dashboard/areas` (meiste Leser zuerst), nicht am
 * Rang des Tages – so behält jeder Bereich seine Farbe, auch wenn ein anderer
 * gerade vorne liegt.
 *
 * Reihenfolge geprüft (OKLab, Farbfehlsichtigkeit simuliert) für hell und
 * dunkel: Indigo, Bernstein, Violett, Grün. Indigo neben Himmelblau oder
 * Violett neben Himmelblau wäre im Dunkeln kaum zu unterscheiden, darum
 * kommt `chart-4` erst an fünfter Stelle.
 */
export const AREA_SERIES = [
  { fill: "var(--chart-1)", bg: "bg-chart-1" },
  { fill: "var(--chart-3)", bg: "bg-chart-3" },
  { fill: "var(--chart-5)", bg: "bg-chart-5" },
  { fill: "var(--chart-2)", bg: "bg-chart-2" },
  { fill: "var(--chart-4)", bg: "bg-chart-4" },
] as const;

/** Ab dem sechsten Bereich: zusammengefasst und grau, keine erfundene Farbe. */
export const AREA_OTHER = { fill: "var(--muted-foreground)", bg: "bg-muted-foreground/60" } as const;

export function areaSeries(index: number): { fill: string; bg: string } {
  return index >= 0 && index < AREA_SERIES.length ? AREA_SERIES[index] : AREA_OTHER;
}
