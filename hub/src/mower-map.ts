/** Maeher-Karte fuer das Cloud-Widget (ohne Abhaengigkeiten, damit testbar). */

/** Kartenquelle des Maeher-Dienstes (GeoJSON in WGS84). */
export interface MowerGeo {
  areas?: { features?: { geometry?: { type?: string; coordinates?: unknown }; properties?: Record<string, unknown> }[] };
  dock?: { lat: number; lon: number } | null;
}

export interface CloudMowerMap {
  v: 1;
  w: number;
  h: number;
  areas: { name: string; pts: string }[];
  obstacles: string[];
  paths: string[];
  dock: [number, number] | null;
  proj: { kx: number; minX: number; minY: number; scale: number; offX: number; offY: number } | null;
}

const MAP_W = 1000;
const MAP_PAD = 24;

/**
 * GeoJSON → Bildkoordinaten fuer das Cloud-Widget. Gleiche Projektion wie
 * die Hub-Karte (equirektangular, Laengengrad mit cos(Breite) gestaucht),
 * Punkte auf 0,1 gerundet, doppelte Punkte entfernt. `proj` erlaubt der
 * Cloud, die Live-Position ohne neue Karte einzutragen.
 */
export function buildCloudMap(geo: MowerGeo | null): CloudMowerMap | null {
  const feats = geo?.areas?.features ?? [];
  const rings: { kind: "area" | "obstacle" | "path"; name: string; coords: [number, number][] }[] = [];
  for (const f of feats) {
    const g = f.geometry ?? {};
    const t = String(f.properties?.type_name ?? "");
    const name = typeof f.properties?.title === "string" ? f.properties.title : "";
    if (g.type === "Polygon" && Array.isArray(g.coordinates) && Array.isArray(g.coordinates[0])) {
      const kind = t === "obstacle" || t.includes("no_go") ? "obstacle" : "area";
      rings.push({ kind, name: kind === "area" && t === "area" ? name : "", coords: g.coordinates[0] as [number, number][] });
    } else if (g.type === "LineString" && Array.isArray(g.coordinates)) {
      rings.push({ kind: "path", name: "", coords: g.coordinates as [number, number][] });
    }
  }
  const pts = rings.flatMap((r) => r.coords).filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (geo?.dock) pts.push([geo.dock.lon, geo.dock.lat]);
  if (pts.length < 3 || !rings.some((r) => r.kind === "area")) return null;

  const lat0 = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  const kx = Math.cos((lat0 * Math.PI) / 180);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [lon, lat] of pts) {
    const x = lon * kx;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, lat); maxY = Math.max(maxY, lat);
  }
  const spanX = maxX - minX || 1e-6;
  const spanY = maxY - minY || 1e-6;
  const scale = (MAP_W - 2 * MAP_PAD) / spanX;
  // Hoehe folgt dem Seitenverhaeltnis, aber nie hoeher als breit (Widget-Platz).
  const h = Math.round(Math.min(MAP_W, Math.max(240, spanY * scale + 2 * MAP_PAD)));
  const s = Math.min(scale, (h - 2 * MAP_PAD) / spanY);
  const offX = (MAP_W - spanX * s) / 2;
  const offY = (h - spanY * s) / 2;
  const P = (lon: number, lat: number): [number, number] => [
    Math.round(((lon * kx - minX) * s + offX) * 10) / 10,
    Math.round((h - ((lat - minY) * s + offY)) * 10) / 10,
  ];
  const line = (coords: [number, number][]) => {
    const out: string[] = [];
    let last = "";
    for (const c of coords) {
      if (!Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
      const [x, y] = P(c[0], c[1]);
      const k = `${x},${y}`;
      if (k !== last) out.push(k);
      last = k;
    }
    return out.join(" ");
  };
  return {
    v: 1,
    w: MAP_W,
    h,
    areas: rings.filter((r) => r.kind === "area").map((r) => ({ name: r.name, pts: line(r.coords) })).filter((a) => a.pts.includes(" ")),
    obstacles: rings.filter((r) => r.kind === "obstacle").map((r) => line(r.coords)).filter((p) => p.includes(" ")),
    paths: rings.filter((r) => r.kind === "path").map((r) => line(r.coords)).filter((p) => p.includes(" ")),
    dock: geo?.dock ? P(geo.dock.lon, geo.dock.lat) : null,
    proj: { kx, minX, minY, scale: s, offX, offY },
  };
}
