/**
 * Ein Speichern der Karte „Einlass-Regeln“ (PUT /api/settings/access-rules)
 * als reine Rechnung: Einlass-Regeln und Regeln für Links und Monitore liegen
 * im selben JSON `Account.accessRules`. Diese Funktion legt einen Patch, der
 * Schlüssel beider Gruppen enthalten darf, über den gelesenen Stand und
 * liefert den ganzen neuen JSON-Wert. Unbekannte Schlüssel und die jeweils
 * andere Gruppe mit ihrem Verlauf bleiben, wie sie sind.
 *
 * Geschrieben wird der Wert nur von der Route, per Vergleich mit dem
 * gelesenen Stand (compare-and-swap). Es gibt keinen zweiten Schreibweg.
 */
import {
  ACCESS_RULE_KEYS,
  mergeAccessRulesPatch,
  type AccessRuleChange,
  type AccessRules,
} from "./access-rules";
import {
  LINK_RULE_KEYS,
  mergeLinkRulesPatch,
  type LinkRuleChange,
  type LinkRules,
} from "./link-rules";

export type SettingsRulesPatch = Partial<AccessRules> & Partial<LinkRules>;

export interface SettingsRulesMerge {
  rules: AccessRules;
  changes: AccessRuleChange[];
  newChanges: AccessRuleChange[];
  links: LinkRules;
  linkChanges: LinkRuleChange[];
  newLinkChanges: LinkRuleChange[];
  /** Ganzer neuer Wert für `Account.accessRules`; null = nichts zu schreiben. */
  stored: Record<string, unknown> | null;
}

function rawObject(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

export function mergeSettingsRulesPatch(
  raw: unknown,
  patch: SettingsRulesPatch,
  who: { at: string; adminId: string | null; admin: string | null },
): SettingsRulesMerge {
  const accessPatch: Partial<AccessRules> = {};
  for (const key of ACCESS_RULE_KEYS) {
    if (patch[key] !== undefined) (accessPatch as Record<string, unknown>)[key] = patch[key];
  }
  const linkPatch: Partial<LinkRules> = {};
  for (const key of LINK_RULE_KEYS) {
    if (patch[key] !== undefined) linkPatch[key] = patch[key];
  }

  const { rules, changes, newChanges } = mergeAccessRulesPatch(raw, accessPatch, who);
  const { links, linkChanges, newLinkChanges } = mergeLinkRulesPatch(raw, linkPatch, who);

  let stored: Record<string, unknown> | null = null;
  if (newChanges.length > 0 || newLinkChanges.length > 0) {
    // Jede Gruppe wird nur angefasst, wenn sie sich ändert; sonst bleibt sie
    // samt Verlauf genau so, wie sie gelesen wurde.
    stored = { ...rawObject(raw) };
    if (newChanges.length > 0) Object.assign(stored, rules, { changes });
    if (newLinkChanges.length > 0) Object.assign(stored, links, { linkChanges });
  }
  return { rules, changes, newChanges, links, linkChanges, newLinkChanges, stored };
}
