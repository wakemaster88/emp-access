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

/** Namen, die nach Zutritt klingen – dann lieber die strengere Stufe. */
const ACCESS_NAME = /(^|[^a-zäöüß])(tor|tür|tuer|türe|schranke|schloss|drehkreuz|einfahrt|eingang|zufahrt|gate)/i;

export function deviceSwitchLevel(device: { type: string; category: string | null; name: string }): McpLevel {
  if (ACCESS_TYPES.has(device.type)) return "access";
  if (ACCESS_NAME.test(device.name)) return "access";
  if (OPERATE_TYPES.has(device.type)) return "operate";
  if (device.category && OPERATE_CATEGORIES.has(device.category)) return "operate";
  // TUER, DREHKREUZ, ROLLTOR, TASTER und Geräte ohne Kategorie
  return "access";
}
