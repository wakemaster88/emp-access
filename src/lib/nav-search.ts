/**
 * Suche in der Seitenleiste: filtert die Menüeinträge nach Name, Gruppe und
 * Stichworten. Groß-/Kleinschreibung, Umlaute (ä = ae) und Bindestriche
 * spielen keine Rolle, alle Wörter der Eingabe müssen vorkommen.
 */

export interface SearchableNavItem {
  label: string;
  keywords?: string[];
}

export interface SearchableNavGroup<T extends SearchableNavItem> {
  label: string;
  items: T[];
}

/** Kleinschreibung, Umlaute ausgeschrieben, Satzzeichen zu Leerzeichen. */
export function normalizeNavText(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function navItemMatches(item: SearchableNavItem, groupLabel: string, query: string): boolean {
  const words = normalizeNavText(query).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalizeNavText([item.label, groupLabel, ...(item.keywords ?? [])].join(" "));
  // Wortanfänge zählen, nicht beliebige Teilstrings: „tor“ findet „Tor“, nicht „Monitor“.
  const tokens = haystack.split(" ");
  return words.every((w) => tokens.some((t) => t.startsWith(w)));
}

/**
 * Gruppen mit den passenden Einträgen, leere Gruppen fallen weg. Reihenfolge
 * und Gruppierung bleiben wie im Menü, damit man sich nicht neu orientieren muss.
 */
export function filterNavGroups<T extends SearchableNavItem, G extends SearchableNavGroup<T>>(
  groups: G[],
  query: string,
): G[] {
  if (!normalizeNavText(query)) return groups;
  return groups
    .map((g) => ({ ...g, items: g.items.filter((item) => navItemMatches(item, g.label, query)) }))
    .filter((g) => g.items.length > 0);
}

/** Erster Treffer, bevorzugt einer, dessen Name selbst passt (für Enter). */
export function firstNavMatch<T extends SearchableNavItem>(
  groups: SearchableNavGroup<T>[],
  query: string,
): T | undefined {
  const all = groups.flatMap((g) => g.items);
  return all.find((item) => navItemMatches({ label: item.label }, "", query)) ?? all[0];
}
