import type { McpLevel } from "./protocol";

/**
 * Welche Stufe braucht ein MCP-Token, um ein Gerät zu schalten?
 *
 * Alles, was Zutritt gewährt (Türen, Tore, Schlösser, Drehkreuze, Taster für
 * Torimpulse) oder dessen Art unklar ist, braucht „access“. Licht, Markisen,
 * Steckdosen, Audio, Bewässerung und Mäher reichen mit „operate“.
 */
const ACCESS_TYPES = new Set(["RASPBERRY_PI", "NUKI_SMARTLOCK", "LOQED_SMARTLOCK"]);
const OPERATE_TYPES = new Set(["HUE_LIGHT", "GARDENA_VALVE", "AUDIO_PLAYER", "MAMMOTION_MOWER"]);
const OPERATE_CATEGORIES = new Set(["BELEUCHTUNG", "SCHALTER", "MARKISE", "AUDIO", "SENSOR"]);

/**
 * Namen, die nach Zutritt klingen – dann lieber die strengere Stufe. Geprüft
 * wird ohne Wortgrenze, damit auch Komposita wie „Schiebetor“ oder
 * „Gartentür“ zählen.
 */
const ACCESS_NAME = /tor|tür|tuer|schranke|schloss|schloß|drehkreuz|einfahrt|eingang|zufahrt|gate|pforte|gatter/i;

/**
 * Wörter, die eins der Zutritts-Wörter nur zufällig enthalten. Sie werden vor
 * der Prüfung aus dem Namen entfernt; „Motor Tor“ bleibt damit ein Tor.
 */
const NOT_ACCESS_WORDS =
  /motor|monitor|ventilator|generator|radiator|projektor|kompressor|akkumulator|detektor|indikator|sektor|rotor|traktor|gateway/gi;

export function accessByName(name: string): boolean {
  // NFC: zerlegte Umlaute (z. B. aus macOS eingefügt) wie „ü“ behandeln.
  return ACCESS_NAME.test(name.normalize("NFC").replace(NOT_ACCESS_WORDS, " "));
}

/**
 * `usedForAccess`: Das Gerät öffnet anderswo Zutritt (Kennzeichen-Freigabe,
 * Personen-Erkennung, Vereinsportal, Rider-Skill, Schließpunkt,
 * Ticket-Gerät) – siehe
 * `loadAccessDeviceIds` in tools.ts.
 */
export function deviceSwitchLevel(
  device: { type: string; category: string | null; name: string },
  usedForAccess = false,
): McpLevel {
  if (ACCESS_TYPES.has(device.type)) return "access";
  if (usedForAccess) return "access";
  if (accessByName(device.name)) return "access";
  if (OPERATE_TYPES.has(device.type)) return "operate";
  if (device.category && OPERATE_CATEGORIES.has(device.category)) return "operate";
  // TUER, DREHKREUZ, ROLLTOR, TASTER und Geräte ohne Kategorie
  return "access";
}
