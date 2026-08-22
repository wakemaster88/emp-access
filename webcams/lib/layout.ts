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

  const grid = 12;
  const cellW = Math.max(1, Math.floor(grid / cols));
  const rowGrid = 8;

  // Duo-3-Kacheln (span 2) würden sonst eine Spalte leer lassen.
  const packed = packFlow(enabled, (w) => widgetSpan(w.id, wideIds), cols);
  const packedRows = Math.max(
    1,
    packed.length === 0 ? 1 : packed[packed.length - 1].row + 1,
  );
  const cellH = Math.max(1, Math.floor(rowGrid / packedRows));
  const tiles: ResolvedTile[] = packed.map((p) => ({
    widget: p.item,
    x: p.col * cellW,
    y: p.row * cellH,
    w: cellW * p.span,
    h: cellH,
  }));

  return {
    cols: cols * cellW,
    rows: packedRows * cellH,
    focusWidgetId: null,
    tiles,
  };
}

function widgetSpan(id: string, wideIds: Set<string>): number {
  return wideIds.has(id) ? 2 : 1;
}

/**
 * Zeilenweise packen. Passt das nächste Element nicht in den Rest der Zeile,
 * wird das nächste passende nach vorn gezogen (Lücken füllen).
 */
export function packFlow<T>(
  items: T[],
  spanOf: (item: T) => number,
  cols: number,
): Array<{ item: T; col: number; row: number; span: number }> {
  const queue = [...items];
  const placed: Array<{ item: T; col: number; row: number; span: number }> = [];
  let cx = 0;
  let cy = 0;
  while (queue.length > 0) {
    const remain = cols - cx;
    const idx = queue.findIndex((item) => spanOf(item) <= remain);
    if (idx < 0) {
      cx = 0;
      cy += 1;
      continue;
    }
    const item = queue.splice(idx, 1)[0];
    const span = spanOf(item);
    placed.push({ item, col: cx, row: cy, span });
    cx += span;
  }
  return placed;
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
