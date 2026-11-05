/**
 * Naechste Zoom-Position fuer Nah/Weit an Kameras mit Zoom-Objektiv ohne
 * Schwenkkopf: ein Achtel des Bereichs, mindestens 1, nie ueber die Grenzen.
 */
export function zoomStep(pos: number, min: number, max: number, dir: 1 | -1, fraction = 1 / 8): number {
  const step = Math.max(1, Math.round((max - min) * fraction));
  return Math.max(min, Math.min(max, pos + dir * step));
}
