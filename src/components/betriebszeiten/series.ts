/**
 * Eine Farbe je Bereich aus der Diagramm-Reihe (docs/design-regeln.md, Abschnitt 15):
 * die Bereiche sind Datenreihen, keine Zustände. Bis sieben Profile wiederholt sich
 * keine Farbe; danach bleiben Name und Reihenfolge eindeutig. Index = Reihenfolge
 * der Bereiche (Profile ohne Oberprofil) auf der Seite (Kalender, Profilkarten, Abgleich).
 * Unterprofile tragen die Farbe ihres Bereichs, aufgehellt.
 */
export const SERIES = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5", "bg-chart-6", "bg-chart-7"];
const SERIES_SOFT = [
  "bg-chart-1/45",
  "bg-chart-2/45",
  "bg-chart-3/45",
  "bg-chart-4/45",
  "bg-chart-5/45",
  "bg-chart-6/45",
  "bg-chart-7/45",
];

export function seriesColor(index: number, soft = false): string {
  return (soft ? SERIES_SOFT : SERIES)[index % SERIES.length];
}

export interface TreeNode {
  id: number;
  name: string;
  parentId: number | null;
}

export interface TreeEntry<T extends TreeNode> {
  item: T;
  /** Unterprofil eines Bereichs. */
  sub: boolean;
  /** Oberprofil bei Unterprofilen. */
  parent: T | null;
  /** Farbe wie im Kalender (Bereich voll, Unterprofil aufgehellt). */
  color: string;
}

/**
 * Bereiche in ihrer Reihenfolge, jedes Unterprofil direkt hinter seinem
 * Bereich. Ein Unterprofil ohne gültiges Oberprofil gilt als eigener Bereich.
 */
export function scheduleTree<T extends TreeNode>(items: T[]): TreeEntry<T>[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const isTop = (i: T) => {
    if (i.parentId == null) return true;
    const parent = byId.get(i.parentId);
    return !parent || parent.parentId != null;
  };
  const out: TreeEntry<T>[] = [];
  items.filter(isTop).forEach((top, index) => {
    out.push({ item: top, sub: false, parent: null, color: seriesColor(index) });
    for (const child of items) {
      if (child.parentId === top.id && !isTop(child)) {
        out.push({ item: child, sub: true, parent: top, color: seriesColor(index, true) });
      }
    }
  });
  return out;
}
