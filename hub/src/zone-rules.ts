/**
 * Flächen im Bild (ohne I/O, testbar): Polygone in normierten Koordinaten
 * 0..1, wie sie die Cloud und die Umgebung liefern. Genutzt von der
 * Einfahrtszone (vision.ts), dem Halteverbot (noparking.ts) und der Belegung
 * (occupancy.ts).
 */

export type Point = { x: number; y: number };

/** Polygon aus der Umgebung: "x,y;x,y;…" mit Werten 0..1. */
export function parseZone(raw: string | undefined): Point[] | null {
  if (!raw) return null;
  const pts: Point[] = [];
  for (const part of raw.split(";")) {
    const [xs, ys] = part.split(",").map((s) => s.trim());
    const x = Number(xs);
    const y = Number(ys);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    pts.push({ x, y });
  }
  return pts.length >= 3 ? pts : null;
}

/** Punkt-in-Polygon (Ray-Casting). */
export function inside(p: Point, poly: Point[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    const crosses =
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y || 1e-9) + a.x;
    if (crosses) hit = !hit;
  }
  return hit;
}
