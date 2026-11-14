/**
 * Baum der Ressourcen (AccessArea) für die Seite „Ressourcen“.
 *
 * Die Datenbank kennt nur `parentId`. Für die Liste brauchen wir die Einträge
 * in Lesereihenfolge: jede Hauptressource, direkt darunter ihre
 * Unterressourcen (rekursiv), jeweils nach Namen sortiert. Ein Eintrag, dessen
 * Elternteil fehlt (gelöscht, anderer Mandant), steht oben als Hauptressource,
 * damit er nicht verschwindet. Ringe (A in B, B in A) werden aufgebrochen.
 */

export interface AreaTreeInput {
  id: number;
  name: string;
  parentId: number | null;
}

export interface AreaTreeRow<T extends AreaTreeInput> {
  area: T;
  /** 0 = Hauptressource, 1 = Unterressource, … */
  depth: number;
  /** Anzahl direkter Unterressourcen. */
  childCount: number;
  /** Letzte Unterressource ihres Elternteils (für die Baumlinie). */
  isLast: boolean;
}

const byName = (a: AreaTreeInput, b: AreaTreeInput) =>
  a.name.localeCompare(b.name, "de", { sensitivity: "base", numeric: true });

export function buildAreaTree<T extends AreaTreeInput>(areas: T[]): AreaTreeRow<T>[] {
  const ids = new Set(areas.map((a) => a.id));
  const children = new Map<number, T[]>();
  const roots: T[] = [];

  for (const area of areas) {
    if (area.parentId != null && area.parentId !== area.id && ids.has(area.parentId)) {
      const list = children.get(area.parentId) ?? [];
      list.push(area);
      children.set(area.parentId, list);
    } else {
      roots.push(area);
    }
  }

  const rows: AreaTreeRow<T>[] = [];
  const seen = new Set<number>();

  const visit = (area: T, depth: number, isLast: boolean) => {
    if (seen.has(area.id)) return;
    seen.add(area.id);
    const kids = (children.get(area.id) ?? []).slice().sort(byName);
    rows.push({ area, depth, childCount: kids.length, isLast });
    kids.forEach((kid, i) => visit(kid, depth + 1, i === kids.length - 1));
  };

  roots.slice().sort(byName).forEach((root) => visit(root, 0, false));

  // Ringe ohne Einstieg (A in B, B in A): als Hauptressourcen anhängen.
  const rest = areas.filter((a) => !seen.has(a.id)).sort(byName);
  rest.forEach((area) => visit(area, 0, false));

  return rows;
}

/**
 * IDs, die als übergeordnete Ressource für `areaId` nicht in Frage kommen:
 * die Ressource selbst und alle ihre Nachfahren (sonst entstünde ein Ring).
 */
export function descendantIds(areas: AreaTreeInput[], areaId: number): Set<number> {
  const blocked = new Set<number>([areaId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const a of areas) {
      if (a.parentId != null && blocked.has(a.parentId) && !blocked.has(a.id)) {
        blocked.add(a.id);
        grew = true;
      }
    }
  }
  return blocked;
}

/**
 * Suche in der Baumansicht: Treffer plus ihre Vorfahren (als Kontext), damit
 * eine gefundene Unterressource nicht ohne ihre Hauptressource dasteht.
 */
export function filterAreaTree<T extends AreaTreeInput>(
  rows: AreaTreeRow<T>[],
  matches: (area: T) => boolean,
): AreaTreeRow<T>[] {
  const byId = new Map(rows.map((r) => [r.area.id, r.area]));
  const keep = new Set<number>();
  for (const { area } of rows) {
    if (!matches(area)) continue;
    let cur: T | undefined = area;
    const guard = new Set<number>();
    while (cur && !guard.has(cur.id)) {
      guard.add(cur.id);
      keep.add(cur.id);
      cur = cur.parentId != null ? byId.get(cur.parentId) : undefined;
    }
  }
  return rows.filter((r) => keep.has(r.area.id));
}

/** Sperrzeit lesbar: „45 Sek.“, „2 Min.“, „1 Std.“ */
export function formatScanLock(seconds: number | null | undefined): string | null {
  if (!seconds || seconds <= 0) return null;
  if (seconds < 60) return `${seconds} Sek.`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} Min.`;
  const h = seconds / 3600;
  return `${Number.isInteger(h) ? h : h.toLocaleString("de-DE", { maximumFractionDigits: 1 })} Std.`;
}
