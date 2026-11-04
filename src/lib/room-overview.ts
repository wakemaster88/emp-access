/**
 * Räume ohne Zuordnung: Gruppen und Raum-Vorschläge aus dem Gerätenamen.
 *
 * Die 59 Geräte ohne Raum heißen fast alle nach ihrem Ort ("Strandbad
 * Beleuchtung Steg", "Kasse Drucker"). Aus dem Namen lässt sich deshalb ein
 * Raum vorschlagen: der längste Raumname, der im Gerätenamen vorkommt. Trifft
 * keiner, wird nach dem ersten Wort gruppiert, damit "Halle …" als Gruppe
 * erscheint und sich mit einem Griff als Raum anlegen lässt.
 *
 * Bewusst ohne React und ohne Prisma, damit die Regeln testbar bleiben.
 */

export interface NamedRoom {
  id: number;
  name: string;
}

export interface LooseItem {
  /** "d12" = Gerät 12, "c7" = Kamera 7, "z3" = Zone 3 – eindeutig über alle Arten. */
  key: string;
  kind: "device" | "camera" | "zone";
  id: number;
  name: string;
  /** "Shelly · Beleuchtung" – Herkunft für die Zeile. */
  meta: string;
}

export interface LooseGroup {
  /** Raumname oder erstes Wort des Namens; "Unklar" ohne brauchbares Wort. */
  label: string;
  /** Raum, der zum Namen passt; null = keiner, dann bietet die Oberfläche "Raum anlegen" an. */
  suggestedRoom: NamedRoom | null;
  items: LooseItem[];
}

/** Wörter, die eine Geräteart beschreiben und keinen Ort – taugen nicht als Gruppe. */
const GENERIC_WORDS = new Set([
  "beleuchtung",
  "licht",
  "lampe",
  "kamera",
  "cam",
  "shelly",
  "sensor",
  "fuehler",
  "taster",
  "tor",
  "rolltor",
  "schalter",
  "steckdose",
  "plug",
  "pumpe",
  "ventil",
  "zone",
  "heizung",
  "lueftung",
  "test",
  "neu",
  "kopie",
  "der",
  "die",
  "das",
]);

/** Kleinschreibung, Umlaute aufgelöst, alles außer Buchstaben und Ziffern zu Leerzeichen. */
export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Längster Raumname, der als ganzes Wort im Gerätenamen vorkommt. */
export function suggestRoom(itemName: string, rooms: NamedRoom[]): NamedRoom | null {
  const haystack = ` ${normalizeName(itemName)} `;
  let best: NamedRoom | null = null;
  let bestLength = 0;
  for (const room of rooms) {
    const needle = normalizeName(room.name);
    if (!needle) continue;
    if (haystack.includes(` ${needle} `) && needle.length > bestLength) {
      best = room;
      bestLength = needle.length;
    }
  }
  return best;
}

/** Erstes Wort des Namens, das einen Ort beschreibt; null wenn keines. */
export function placeWord(itemName: string): string | null {
  const words = normalizeName(itemName).split(" ").filter(Boolean);
  for (const word of words) {
    if (word.length < 3) continue;
    if (/^\d+$/.test(word)) continue;
    if (GENERIC_WORDS.has(word)) continue;
    return word;
  }
  return null;
}

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** Originalschreibweise des Ortswortes aus dem Namen holen ("Strandbad" statt "strandbad"). */
function originalWord(itemName: string, normalized: string): string {
  for (const raw of itemName.split(/[^\p{L}\p{N}]+/u)) {
    if (normalizeName(raw) === normalized) return raw;
  }
  return titleCase(normalized);
}

export const UNCLEAR_LABEL = "Unklar";

/**
 * Gruppen für den Tab "Ohne Raum": zuerst die mit Raum-Vorschlag (nach Größe),
 * dann die mit Ortswort, zuletzt "Unklar".
 */
export function groupLooseItems(items: LooseItem[], rooms: NamedRoom[]): LooseGroup[] {
  const byRoom = new Map<number, LooseGroup>();
  const byWord = new Map<string, LooseGroup>();
  const unclear: LooseItem[] = [];
  for (const item of items) {
    const room = suggestRoom(item.name, rooms);
    if (room) {
      const group = byRoom.get(room.id) ?? { label: room.name, suggestedRoom: room, items: [] };
      group.items.push(item);
      byRoom.set(room.id, group);
      continue;
    }
    const word = placeWord(item.name);
    if (!word) {
      unclear.push(item);
      continue;
    }
    const group = byWord.get(word) ?? { label: originalWord(item.name, word), suggestedRoom: null, items: [] };
    group.items.push(item);
    byWord.set(word, group);
  }
  const bySize = (a: LooseGroup, b: LooseGroup) => b.items.length - a.items.length || a.label.localeCompare(b.label, "de");
  const groups = [...[...byRoom.values()].sort(bySize), ...[...byWord.values()].sort(bySize)];
  if (unclear.length > 0) groups.push({ label: UNCLEAR_LABEL, suggestedRoom: null, items: unclear });
  return groups;
}

/** Ein Gerät/Kamera/Zone in der Auswahl – zur Vollersetzung je Raum zusammengefasst. */
export function splitByKind(items: LooseItem[]): { deviceIds: number[]; cameraIds: number[]; zoneIds: number[] } {
  return {
    deviceIds: items.filter((i) => i.kind === "device").map((i) => i.id),
    cameraIds: items.filter((i) => i.kind === "camera").map((i) => i.id),
    zoneIds: items.filter((i) => i.kind === "zone").map((i) => i.id),
  };
}
