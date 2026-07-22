import { REOLINK_CAPS, type Config, type Layout, type Widget } from "./types";

export interface ResolvedTile {
  widget: Widget;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ResolvedLayout {
  cols: number;
  rows: number;
  focusWidgetId: string | null;
  tiles: ResolvedTile[];
}

function autoLayout(widgets: Widget[], wideIds: Set<string>): ResolvedLayout {
  const enabled = widgets.filter((w) => w.enabled);
  const total = enabled.length;
  if (total === 0) {
    return { cols: 12, rows: 8, focusWidgetId: null, tiles: [] };
  }
  // Panorama-Widgets (Duo 3, ~32:9) zählen doppelt breit — Spaltenzahl auf
  // Basis der belegten Zellen wählen, damit 16:9-Tiles ~quadratisch bleiben.
  const units = enabled.reduce((sum, w) => sum + (wideIds.has(w.id) ? 2 : 1), 0);
  const ratio = 16 / 9;
  let cols = Math.max(1, Math.round(Math.sqrt(units * ratio)));
  // Wide-Tiles brauchen mindestens 2 Spalten.
  if (wideIds.size > 0 && cols < 2) cols = 2;
  const rows = Math.max(1, Math.ceil(units / cols));

  const grid = 12;
  const cellW = Math.max(1, Math.floor(grid / cols));
  const rowGrid = 8;
  const cellH = Math.max(1, Math.floor(rowGrid / rows));

  // Flow-Packing: Zellen zeilenweise füllen; wide = 2 Zellen, bei Bedarf
  // Zeilenumbruch, damit ein Panorama nicht über den Rand läuft.
  const tiles: ResolvedTile[] = [];
  let cx = 0;
  let cy = 0;
  for (const widget of enabled) {
    const span = wideIds.has(widget.id) ? 2 : 1;
    if (cx + span > cols) {
      cx = 0;
      cy += 1;
    }
    tiles.push({
      widget,
      x: cx * cellW,
      y: cy * cellH,
      w: cellW * span,
      h: cellH,
    });
    cx += span;
  }

  return {
    cols: cols * cellW,
    rows: (cy + 1) * cellH,
    focusWidgetId: null,
    tiles,
  };
}

export function resolveLayout(config: Config, layout?: Layout | null): ResolvedLayout {
  const widgets = config.widgets;
  if (!layout) return autoLayout(widgets, wideWidgetIds(config));

  const tiles: ResolvedTile[] = [];
  for (const widget of widgets) {
    if (!widget.enabled) continue;
    const pos = layout.positions[widget.id] ?? widget.layout;
    if (!pos) continue;
    tiles.push({
      widget,
      x: pos.x,
      y: pos.y,
      w: pos.w,
      h: pos.h,
    });
  }

  return {
    cols: layout.cols,
    rows: layout.rows,
    focusWidgetId: layout.focusWidgetId,
    tiles,
  };
}

/** Widget-IDs von Reolink-Widgets, deren Cam ein Panorama-Modell ist (Duo 3). */
function wideWidgetIds(config: Config): Set<string> {
  const out = new Set<string>();
  for (const w of config.widgets) {
    if (w.type !== "reolink") continue;
    const cam = config.cams.find((c) => c.id === w.camId);
    if (cam && REOLINK_CAPS[cam.model]?.wide) out.add(w.id);
  }
  return out;
}

export function findActiveLayout(config: Config): Layout | null {
  if (!config.activeLayoutId) return null;
  return config.layouts.find((l) => l.id === config.activeLayoutId) ?? null;
}
