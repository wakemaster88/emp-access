/**
 * Wiederkehrende unbekannte Fahrzeuge: Nach mehreren Besuchen fragt der
 * Assistent per Telegram, ob das Kennzeichen auf die genehmigte Liste soll.
 *
 * Die Knoepfe tragen das Kennzeichen selbst (`vok:`/`vno:`), damit eine
 * Antwort auch nach einem Hub-Neustart (Auto-Update) noch funktioniert.
 * „Genehmigen“ legt das Fahrzeug in der Cloud an (POST
 * /api/hub/allowed-vehicles, nur an der Kamera, an der es gesehen wurde) und
 * laedt die Liste neu. Danach loest es keinen Waechter-Alarm mehr aus.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { CONFIG, api, log } from "../config.js";
import { recordHubEvent, type HubEvent } from "../state.js";
import { captureSnapshot, findCameraByRef } from "../cameras.js";
import { captureDoorbirdSnapshot, isDoorbird } from "../doorbird.js";
import { findAllowedVehicle, refreshVehicleWhitelist } from "../plate.js";
import { sendPhoto, sendText, type TgButton } from "./telegram.js";
import { inQuietHours } from "./quiet.js";
import { berlinHour } from "./watch.js";
import { markPlate, normalizePlate, notePlate, type PlateBook } from "./repeat-vehicles.js";

const ASK = !/^(off|0|false)$/i.test((process.env.HUB_AGENT_VEHICLE_ASK || "on").trim());
const MIN_VISITS = Number(process.env.HUB_AGENT_VEHICLE_VISITS) >= 2 ? Number(process.env.HUB_AGENT_VEHICLE_VISITS) : 3;
const QUIET = (process.env.HUB_AGENT_QUIET ?? "22-7").trim();
/** Wie lange nach einem VEHICLE-Alarm das erkannte Kennzeichen zaehlt. */
const MATCH_WINDOW_MS = 90_000;

let book: PlateBook = {};
let loaded = false;
const deferred = new Set<string>();
/** Letztes Kennzeichen je Kamera (fuer den Waechter: bekannt → kein Alarm). */
const lastByCamera = new Map<string, { at: number; plate: string | null; listed: boolean }>();

function bookPath(): string {
  return path.join(CONFIG.hubDir, ".cache", "agent-vehicles.json");
}

async function load(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    book = JSON.parse(await readFile(bookPath(), "utf8")) as PlateBook;
  } catch {
    book = {};
  }
}

async function save(): Promise<void> {
  // Alte, nie wieder gesehene Eintraege nach 60 Tagen vergessen.
  const cutoff = Date.now() - 60 * 24 * 60 * 60_000;
  for (const [k, r] of Object.entries(book)) if (r.lastAt < cutoff && r.state !== "approved") delete book[k];
  await mkdir(path.dirname(bookPath()), { recursive: true });
  await writeFile(bookPath(), JSON.stringify(book, null, 2), "utf8");
}

const day = (ms: number) =>
  new Date(ms).toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });

/** Kennzeichen bekannt: auf der Liste oder gerade per Telegram genehmigt. */
export function plateKnown(plate: string | null | undefined): boolean {
  if (!plate) return false;
  if (findAllowedVehicle(plate)) return true;
  return book[normalizePlate(plate)]?.state === "approved";
}

/**
 * Hat die Kamera kurz nach `since` ein bekanntes Kennzeichen gelesen?
 * true = bekannt, false = unbekannt/kein Kennzeichen, null = noch nichts.
 */
export function cameraSawKnownPlate(cameraName: string, since: number): boolean | null {
  const last = lastByCamera.get(cameraName);
  if (!last || last.at < since - MATCH_WINDOW_MS) return null;
  return last.listed || plateKnown(last.plate);
}

async function ask(key: string, chatIds: string[]): Promise<void> {
  const rec = book[key];
  if (!rec || !chatIds.length) return;
  const cam = rec.camera ? findCameraByRef(rec.camera) : null;
  const caption =
    `🚗 Kennzeichen ${rec.plate} war jetzt ${rec.visits}-mal da` +
    ` (zuerst ${day(rec.firstAt)}, zuletzt ${day(rec.lastAt)}${cam ? `, ${cam.name}` : ""}).\n` +
    `Auf die genehmigte Liste setzen? Dann gibt es dafür keinen Alarm mehr, und wie bei allen genehmigten Fahrzeugen ` +
    `kann sich das Tor bei Erkennung an dieser Kamera automatisch öffnen.`;
  const buttons: TgButton[][] = [
    [
      { text: "Genehmigen", callback_data: `vok:${key}` },
      { text: "Nein", callback_data: `vno:${key}` },
    ],
  ];
  let jpeg: Buffer | null = null;
  if (cam) {
    jpeg = await (isDoorbird(cam.id) ? captureDoorbirdSnapshot(cam.id) : captureSnapshot(cam.id)).catch(() => null);
  }
  for (const id of chatIds) {
    if (jpeg) await sendPhoto(id, jpeg, caption, buttons).catch(() => sendText(id, caption, buttons));
    else await sendText(id, caption, buttons).catch(() => undefined);
  }
  log(`Assistent: frage nach Kennzeichen ${rec.plate} (${rec.visits} Besuche)`);
}

/** Aus dem Waechter-Takt: neue Hub-Ereignisse verbuchen, ggf. fragen. */
export async function vehicleTick(events: HubEvent[], chatIds: string[]): Promise<void> {
  await load();
  let dirty = false;
  const now = Date.now();
  for (const ev of events) {
    if (ev.kind !== "vehicle" || !ev.where || ev.where === "Assistent") continue;
    lastByCamera.set(ev.where, { at: now, plate: ev.plate ?? null, listed: !!ev.listed });
    if (!ASK || !ev.plate || ev.listed || plateKnown(ev.plate)) continue;
    dirty = true;
    if (notePlate(book, ev.plate, now, { minVisits: MIN_VISITS, camera: ev.where })) deferred.add(normalizePlate(ev.plate));
  }
  if (deferred.size && !inQuietHours(QUIET, berlinHour()) && chatIds.length) {
    for (const key of [...deferred]) {
      deferred.delete(key);
      await ask(key, chatIds).catch((e) => log(`Assistent: Kennzeichen-Frage: ${e instanceof Error ? e.message : e}`));
    }
  }
  if (dirty) await save().catch(() => undefined);
}

/** Antwort auf einen Kennzeichen-Knopf. Liefert den Text fuer die Nachricht. */
export async function answerVehicle(approve: boolean, key: string): Promise<string> {
  await load();
  const plate = book[key]?.plate ?? key;
  if (!approve) {
    markPlate(book, plate, "declined");
    await save().catch(() => undefined);
    recordHubEvent({ kind: "vehicle", severity: "info", where: "Assistent", title: `Kennzeichen ${plate} nicht genehmigt` });
    return `Ok, ${plate} bleibt unbekannt. Ich frage dazu nicht mehr.`;
  }
  if (findAllowedVehicle(plate)) {
    markPlate(book, plate, "approved");
    await save().catch(() => undefined);
    return `${plate} steht schon auf der genehmigten Liste.`;
  }
  const cam = book[key]?.camera ? findCameraByRef(book[key].camera!) : null;
  const body: Record<string, unknown> = { plate };
  if (cam) body.cameraId = cam.id;
  const res = await api("/api/hub/allowed-vehicles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: unknown };
  const already = typeof json.error === "string" && /existiert bereits/.test(json.error);
  if (!res.ok && !already) {
    const msg = typeof json.error === "string" ? json.error : `HTTP ${res.status}`;
    log(`Assistent: Genehmigen ${plate} fehlgeschlagen: ${msg}`);
    return `Konnte ${plate} nicht genehmigen: ${msg}. Bitte in der Fahrzeugverwaltung anlegen.`;
  }
  markPlate(book, plate, "approved");
  await save().catch(() => undefined);
  await refreshVehicleWhitelist().catch(() => undefined);
  recordHubEvent({ kind: "vehicle", severity: "info", where: "Assistent", title: `Kennzeichen ${plate} genehmigt (Telegram)` });
  log(`Assistent: Kennzeichen ${plate} genehmigt`);
  return `✅ ${plate} ist genehmigt${cam ? ` (Kamera ${cam.name})` : ""}. Kein Alarm mehr für dieses Fahrzeug.`;
}
