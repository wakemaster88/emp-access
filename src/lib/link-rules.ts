/**
 * Regeln für Links und Monitore: strengere Grenzen für die Links ohne
 * Anmeldung (Mitarbeiter-Handy, Kiosk, Wandanzeigen) und kleine Anpassungen,
 * die der Betreiber in den Einstellungen einzeln einschaltet. Ab Werk ist
 * jede Regel aus; dann verhalten sich die betroffenen Seiten und Routen genau
 * wie ohne diese Datei.
 *
 * Gespeichert in `Account.accessRules` (JSON, neben den Einlass-Regeln),
 * Änderungsverlauf unter `linkChanges`. Alles, was dort fehlt oder nicht
 * passt, gilt als „aus“.
 *
 * Bewusst ohne Prisma-Client, damit Einstellungs-Karte und Handy-Seite die
 * Typen, Texte und Prüfungen importieren können.
 */
import { deviceControlModel, type ControllableDevice } from "./device-controls";

export const LINK_RULE_KEYS = [
  "mobileEmergencyNeedsGrant",
  "kioskDoorsAssignedOnly",
  "monitorHideNames",
  "resumeOnlyOwnPause",
  "riderShortIntro",
] as const;

export type LinkRuleKey = (typeof LINK_RULE_KEYS)[number];

export type LinkRules = Record<LinkRuleKey, boolean>;

export const LINK_RULES_OFF: LinkRules = {
  mobileEmergencyNeedsGrant: false,
  kioskDoorsAssignedOnly: false,
  monitorHideNames: false,
  resumeOnlyOwnPause: false,
  riderShortIntro: false,
};

/** Ein Eintrag im Änderungsverlauf der Regeln. */
export interface LinkRuleChange {
  /** ISO-Zeitpunkt. */
  at: string;
  adminId: string | null;
  /** E-Mail oder Name des Admins zum Anzeigen. */
  admin: string | null;
  key: LinkRuleKey;
  from: boolean;
  to: boolean;
}

export const LINK_RULE_TEXTS: Record<LinkRuleKey, { title: string; effect: string; confirm?: string }> = {
  mobileEmergencyNeedsGrant: {
    title: "NOT-AUF und Sperren am Mitarbeiter-Handy nur für freigeschaltete Mitarbeiter",
    effect:
      "Über den Handy-Link können nur noch Mitarbeiter mit dem Haken „NOT-AUF und Sperren erlaubt“ ein Drehkreuz dauerhaft öffnen (NOT-AUF) oder ein Gerät sperren. Öffnen, Schalten und Abschließen an Smart Locks bleiben für alle.",
    confirm:
      "Danach im Mitarbeiter-Dialog bei den Mitarbeitern, die NOT-AUF weiter brauchen, den Haken setzen. Bis dahin fehlt die Taste auf ihren Handys. Offene Handy-Seiten blenden sie spätestens nach einer Minute aus und zeigen bei Ablehnung die Meldung. Eine Seite, die vor diesem Update geladen wurde, zeigt die Taste weiter und vibriert bei Ablehnung nur, ohne Text: die Mitarbeiter die Seite vorher einmal neu laden lassen.",
  },
  kioskDoorsAssignedOnly: {
    title: "Kiosk-Link öffnet nur zugeordnete Türen",
    effect:
      "Der Check-in-Kiosk zeigt und öffnet nur noch die Türen und Drehkreuze, die am Monitor als Tür-Schnellzugriff eingetragen sind. Die übrigen fehlen im Menü „Mehr Türen“.",
    confirm:
      "Vorher an jedem Kiosk-Monitor die Türen eintragen, die das Personal dort öffnen soll. Ein Kiosk ohne eingetragene Tür zeigt danach keine Tür mehr.",
  },
  monitorHideNames: {
    title: "Kundennamen am Auslastungs-Monitor ausblenden",
    effect:
      "Der Auslastungs-Monitor zeigt bei gebuchten Zeiten nur noch die Zahl der Buchungen, keine Kundennamen mehr.",
  },
  resumeOnlyOwnPause: {
    title: "„Alle fortsetzen“ hebt nur die eigene Pause auf",
    effect:
      "„Alle fortsetzen“ am Scan-Monitor setzt nur Tickets fort, die mit „Alle pausieren“ pausiert wurden, und zwar auf ihren Status davor. Einzeln, wegen offener Zahlung oder im Abgleich pausierte Tickets bleiben pausiert; ein Monitor ohne Bereich setzt nichts fort. Tickets, die schon vor diesem Update mit „Alle pausieren“ pausiert wurden, tragen keine Kennung und werden vom Knopf nicht fortgesetzt.",
    confirm:
      "Noch pausierte Tickets aus einer früheren Massen-Pause danach einzeln oder vorher mit „Alle fortsetzen“ fortsetzen.",
  },
  riderShortIntro: {
    title: "Kurze Start-Animation in der Kunden-App",
    effect:
      "Die Logo-Animation beim Öffnen der Kunden-App dauert etwa 0,65 statt 1,3 Sekunden. Sie läuft weiter einmal je Sitzung und entfällt bei „Bewegung reduzieren“.",
  },
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Roh-JSON aus `Account.accessRules` in Regeln; an ist nur genau `true`. */
export function parseLinkRules(raw: unknown): LinkRules {
  const out: LinkRules = { ...LINK_RULES_OFF };
  if (!isPlainObject(raw)) return out;
  for (const key of LINK_RULE_KEYS) out[key] = raw[key] === true;
  return out;
}

/** Änderungsverlauf aus dem Roh-JSON; unlesbare Einträge fallen weg. */
export function parseLinkRuleChanges(raw: unknown): LinkRuleChange[] {
  if (!isPlainObject(raw) || !Array.isArray(raw.linkChanges)) return [];
  const keys = new Set<string>(LINK_RULE_KEYS);
  const out: LinkRuleChange[] = [];
  for (const c of raw.linkChanges) {
    if (!isPlainObject(c)) continue;
    if (typeof c.at !== "string" || typeof c.key !== "string" || !keys.has(c.key)) continue;
    if (typeof c.from !== "boolean" || typeof c.to !== "boolean") continue;
    out.push({
      at: c.at,
      adminId: typeof c.adminId === "string" ? c.adminId : null,
      admin: typeof c.admin === "string" ? c.admin : null,
      key: c.key as LinkRuleKey,
      from: c.from,
      to: c.to,
    });
  }
  return out;
}

/** Änderungen zwischen zwei Ständen, in der Reihenfolge von LINK_RULE_KEYS. */
export function diffLinkRules(
  before: LinkRules,
  after: LinkRules,
): Array<{ key: LinkRuleKey; from: boolean; to: boolean }> {
  return LINK_RULE_KEYS.filter((k) => before[k] !== after[k]).map((k) => ({ key: k, from: before[k], to: after[k] }));
}

/** So viele Einträge behält der Verlauf `linkChanges` (wie bei den Einlass-Regeln). */
export const LINK_RULE_CHANGES_KEPT = 50;

/**
 * Neuer Stand der Regeln für Links und Monitore nach einer Änderung (PUT der
 * Einstellungen): `patch` über die gelesenen Regeln gelegt, die neuen
 * Einträge vorn im Verlauf `linkChanges` (höchstens LINK_RULE_CHANGES_KEPT).
 * Ohne Änderung ist `newLinkChanges` leer. Rein, ohne Datenbank; das
 * Schreiben übernimmt `mergeSettingsRulesPatch` (settings-rules-patch.ts).
 */
export function mergeLinkRulesPatch(
  raw: unknown,
  patch: Partial<LinkRules>,
  who: { at: string; adminId: string | null; admin: string | null },
): { links: LinkRules; linkChanges: LinkRuleChange[]; newLinkChanges: LinkRuleChange[] } {
  const before = parseLinkRules(raw);
  const links: LinkRules = { ...before };
  for (const key of LINK_RULE_KEYS) {
    const value = patch[key];
    if (typeof value === "boolean") links[key] = value;
  }
  const newLinkChanges: LinkRuleChange[] = diffLinkRules(before, links).map((c) => ({ ...who, ...c }));
  const linkChanges = [...[...newLinkChanges].reverse(), ...parseLinkRuleChanges(raw)].slice(
    0,
    LINK_RULE_CHANGES_KEPT,
  );
  return { links, linkChanges, newLinkChanges };
}

// ---------------------------------------------------------------------------
// Die einzelnen Regeln (rein, ohne Datenbank)
// ---------------------------------------------------------------------------

/**
 * Braucht diese Aktion am Handy-Link die Freischaltung des Mitarbeiters?
 * NOT-AUF (`emergency`) immer; Sperren (`deactivate`) außer an Smart Locks
 * (dort heißt es „Abschließen“) und an Antrieben (dort heißt es „Stopp“).
 */
export function mobileActionNeedsGrant(action: string, device: ControllableDevice): boolean {
  if (action === "emergency") return true;
  if (action !== "deactivate") return false;
  const model = deviceControlModel(device);
  return model !== "LOCK" && model !== "COVER";
}

/**
 * Regel „NOT-AUF und Sperren … nur für freigeschaltete Mitarbeiter“: Darf
 * der Mitarbeiter diese Aktionen auslösen? Bei ausgeschalteter Regel immer.
 */
export function mayUseMobileEmergency(rules: LinkRules, employeeHasGrant: boolean): boolean {
  return !rules.mobileEmergencyNeedsGrant || employeeHasGrant;
}

/** Geräte-IDs aus `MonitorConfig.deviceIds` (JSON); Unlesbares fällt weg. */
export function monitorDeviceIdList(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(Number).filter((n) => Number.isInteger(n) && n > 0);
}

/**
 * Regel „Kiosk-Link öffnet nur zugeordnete Türen“: Darf der Kiosk dieses
 * Gerät öffnen? Bei ausgeschalteter Regel jedes (Kategorie prüft die Route).
 */
export function kioskDoorAllowed(rules: LinkRules, monitorDeviceIds: unknown, deviceId: number): boolean {
  return !rules.kioskDoorsAssignedOnly || monitorDeviceIdList(monitorDeviceIds).includes(deviceId);
}

/** Türliste des Kiosks: bei eingeschalteter Regel nur die zugeordneten. */
export function kioskVisibleDoors<T extends { id: number }>(
  rules: LinkRules,
  doors: T[],
  monitorDeviceIds: unknown,
): T[] {
  if (!rules.kioskDoorsAssignedOnly) return doors;
  const ids = monitorDeviceIdList(monitorDeviceIds);
  return doors.filter((d) => ids.includes(d.id));
}

/**
 * Regel „Kundennamen am Auslastungs-Monitor ausblenden“: leert die Namen je
 * Slot. Zahl, Zeiten und Zusammenfassung der Slots bleiben, wie sie sind.
 */
export function hideMonitorNames<S extends { names: string[] }, R extends { slots: S[] }>(
  rules: LinkRules,
  resources: R[],
): R[] {
  if (!rules.monitorHideNames) return resources;
  return resources.map((r) => ({ ...r, slots: r.slots.map((slot) => ({ ...slot, names: [] })) }));
}

export const KIOSK_DOOR_DENIED_MESSAGE = "Diese Tür ist diesem Kiosk nicht zugeordnet.";

export const MOBILE_ACTION_DENIED_MESSAGE =
  "NOT-AUF und Sperren sind für dich nicht freigeschaltet. Bitte an die Verwaltung wenden.";
