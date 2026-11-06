/**
 * Lieferdienste am Tor: DHL, UPS, GLS, Amazon, DPD, Hermes an der Aufschrift
 * des Fahrzeugs erkennen und – je nach Kamera-Einstellung – nur melden oder
 * das Tor (DoorBird) öffnen.
 *
 * Schutz gegen Fehlöffnungen:
 * - Die Marke muss auf mindestens HUB_DELIVERY_MIN_FRAMES (2) Bildern stehen,
 *   jeweils mit einem Fahrzeug in Einfahrtszone und Mindestgröße (YOLO).
 * - Geöffnet wird nur im Zeitfenster der Kamera (Standard 07:00–20:00, Mo–Sa).
 * - Nach einer Öffnung Sperrzeit HUB_DELIVERY_COOLDOWN_MIN (5 min) je Kamera.
 * - Jeder Treffer geht als Push mit Foto in die Cloud, auch ohne Öffnung.
 *
 * Grenze: Wer „DHL“ groß auf ein Auto schreibt, kommt rein. Deshalb das
 * Zeitfenster und der Push bei jeder Öffnung.
 *
 * Am Kennzeichen: Steht die Marke auf mindestens einem Bild und ist das
 * Kennzeichen sicher gelesen, merkt sich der Hub beides. Beim naechsten
 * Besuch meldet er den Lieferdienst schon am Kennzeichen, oeffnet so aber
 * nie das Tor (delivery-plates-rules.ts).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { CONFIG, log } from "./config.js";
import { listDoorbirdIds, openDoorbirdDoor } from "./doorbird.js";
import { readTextFromJpeg } from "./plate.js";
import { jpegContainsVehicle } from "./vision.js";
import { recordHubEvent } from "./state.js";
import { improve } from "./improve-log.js";
import { inDeliveryWindow, matchDeliveryBrand } from "./delivery-match.js";
import { PLATE_MIN_CONF, brandForPlate, rememberPlate, type PlateMemory } from "./delivery-plates-rules.js";

const MIN_FRAMES = Math.max(1, Number(process.env.HUB_DELIVERY_MIN_FRAMES) || 2);
/** Höchstens so viele Bilder lesen (je ~1,5 s Texterkennung). */
const MAX_FRAMES = Math.max(MIN_FRAMES, Number(process.env.HUB_DELIVERY_MAX_FRAMES) || 4);
const COOLDOWN_MS = (Number(process.env.HUB_DELIVERY_COOLDOWN_MIN) || 5) * 60_000;
export type DeliveryMode = "NOTIFY" | "OPEN";

export interface DeliveryConfig {
  id: number;
  name: string;
  deliveryMode?: string | null;
  deliveryFrom?: string | null;
  deliveryTo?: string | null;
  vehicleMinArea?: number | null;
  vehicleZone?: [number, number][] | null;
}

export interface DeliveryResult {
  brand: string;
  /** Bilder mit Marke (Index im Burst). */
  frames: number[];
  /** Bestes Bild fürs Foto. */
  frameIndex: number;
  opened: boolean;
  /** Warum nicht geöffnet (nur melden, Zeitfenster, Sperrzeit, Fehler). */
  reason: string | null;
}

/** Kennzeichen aus dem Burst (Plate-OCR) fuer das Wiedererkennen am Kennzeichen. */
export interface DeliveryPlate {
  plate: string | null;
  confidence: number;
  /** Bild mit dem Kennzeichen (fuers Foto). */
  frameIndex: number;
}

const lastOpenAt = new Map<number, number>();

const PLATES_FILE = path.join(CONFIG.hubDir, ".cache", "delivery-plates.json");
let plates: PlateMemory | null = null;

async function plateMemory(): Promise<PlateMemory> {
  if (plates) return plates;
  try {
    const raw = JSON.parse(await fs.readFile(PLATES_FILE, "utf8")) as unknown;
    plates = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as PlateMemory) : {};
  } catch {
    plates = {};
  }
  return plates;
}

async function savePlates(mem: PlateMemory): Promise<void> {
  try {
    await fs.mkdir(path.dirname(PLATES_FILE), { recursive: true });
    await fs.writeFile(PLATES_FILE, JSON.stringify(mem));
  } catch (e) {
    log(`Lieferdienst: Kennzeichen speichern fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
  }
}

/** Nur melden: Marke stand nicht (genug) lesbar am Auto, aber das Kennzeichen ist bekannt. */
function byPlate(cam: DeliveryConfig, brand: string, plate: string, frameIndex: number): DeliveryResult {
  log(`Lieferdienst ${cam.name}: ${brand} am Kennzeichen ${plate} erkannt – nur melden`);
  improve("delivery", "plate", { cam: cam.name, brand });
  recordHubEvent({ kind: "vehicle", severity: "alert", where: cam.name, title: `${brand} erkannt`, detail: "am Kennzeichen" });
  return { brand, frames: [], frameIndex, opened: false, reason: "am Kennzeichen erkannt" };
}

function resolveDoorbirdId(): number | null {
  const env = Number(process.env.HUB_DELIVERY_DOORBIRD_ID);
  if (Number.isInteger(env) && env > 0) return env;
  const ids = listDoorbirdIds();
  return ids.length === 1 ? ids[0] : null;
}

/**
 * Burst-Bilder auf Lieferdienst prüfen und ggf. das Tor öffnen.
 * `null` = Funktion aus oder keine Marke auf genug Bildern.
 */
export async function checkDelivery(
  cam: DeliveryConfig,
  snaps: Buffer[],
  seen: DeliveryPlate | null = null
): Promise<DeliveryResult | null> {
  const mode = cam.deliveryMode === "OPEN" || cam.deliveryMode === "NOTIFY" ? cam.deliveryMode : null;
  if (!mode || snaps.length === 0) return null;

  // Späte Bilder zuerst: das Fahrzeug steht dann näher und größer im Bild.
  const counts = new Map<string, number[]>();
  let read = 0;
  for (let i = snaps.length - 1; i >= 0 && read < MAX_FRAMES; i--) {
    const vehicle = await jpegContainsVehicle(snaps[i], {
      quick: true,
      cameraId: cam.id,
      label: `${cam.name} Lieferdienst`,
      minArea: cam.vehicleMinArea ?? undefined,
      zone: cam.vehicleZone ?? undefined,
    });
    // Tracker nicht erreichbar (null): Text trotzdem lesen, nur ein klares Nein überspringt.
    if (vehicle === false) continue;
    read++;
    const brand = matchDeliveryBrand(await readTextFromJpeg(snaps[i]));
    if (!brand) continue;
    const list = counts.get(brand) ?? [];
    list.push(i);
    counts.set(brand, list);
    if (list.length >= MIN_FRAMES) break;
  }

  const best = [...counts.entries()].sort((a, b) => b[1].length - a[1].length)[0];

  // Erst nachschlagen, dann lernen: Eine einzelne Aufschrift zaehlt so erst
  // beim naechsten Besuch desselben Fahrzeugs.
  const plate = seen?.plate && seen.confidence >= PLATE_MIN_CONF ? seen.plate : null;
  const mem = plate ? await plateMemory() : null;
  const known = plate && mem ? brandForPlate(mem, plate, Date.now()) : null;
  if (plate && mem && (best || known)) {
    const brandNow = best?.[0] ?? known!;
    if (rememberPlate(mem, plate, brandNow, Date.now())) log(`Lieferdienst ${cam.name}: ${plate} als ${brandNow} gemerkt`);
    await savePlates(mem);
  }

  if (!best || best[1].length < MIN_FRAMES) {
    if (!best) {
      if (read > 0) improve("delivery", "none", { cam: cam.name, frames: read });
    } else {
      log(`Lieferdienst ${cam.name}: ${best[0]} nur auf ${best[1].length}/${MIN_FRAMES} Bildern – kein Treffer`);
      improve("delivery", "weak", { cam: cam.name, brand: best[0], frames: best[1].length });
    }
    return known && plate && seen ? byPlate(cam, known, plate, seen.frameIndex) : null;
  }
  const [brand, frames] = best;

  let opened = false;
  let reason: string | null = null;
  const last = lastOpenAt.get(cam.id) ?? 0;
  if (mode === "NOTIFY") reason = "nur melden";
  else if (!inDeliveryWindow(cam.deliveryFrom, cam.deliveryTo)) reason = "außerhalb des Zeitfensters";
  else if (Date.now() - last < COOLDOWN_MS) reason = "Sperrzeit nach letzter Öffnung";
  else {
    const doorId = resolveDoorbirdId();
    if (doorId == null) reason = "kein DoorBird eindeutig (HUB_DELIVERY_DOORBIRD_ID setzen)";
    else {
      const r = await openDoorbirdDoor(doorId);
      opened = r.ok;
      if (r.ok) lastOpenAt.set(cam.id, Date.now());
      else reason = r.error ?? "Tor öffnen fehlgeschlagen";
    }
  }

  log(`Lieferdienst ${cam.name}: ${brand} auf ${frames.length} Bildern – ${opened ? "Tor geöffnet" : reason}`);
  improve("delivery", opened ? "opened" : "detected", { cam: cam.name, brand, reason });
  recordHubEvent({
    kind: "vehicle",
    severity: "alert",
    where: cam.name,
    title: opened ? `${brand}: Tor geöffnet` : `${brand} erkannt`,
    detail: opened ? `${frames.length} Bilder` : reason ?? undefined,
  });
  return { brand, frames, frameIndex: frames[0], opened, reason };
}
