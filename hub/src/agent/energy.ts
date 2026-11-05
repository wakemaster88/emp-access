/**
 * Energie-, Maeh- und Bewaesserungs-Waechter des Hub-Assistenten.
 *
 * Alle 5 Minuten, nach festen Regeln (energy-rules.ts):
 *  - Licht und Schalter, die ausserhalb der Betriebszeit ihres Raums seit
 *    mindestens 45 Minuten an sind, ohne dass eine Kamera im Raum jemanden
 *    gesehen hat → Vorschlag „Ausschalten“ per Telegram. Heizungen und Luefter
 *    der Cloud-Klimaregelung bleiben aussen vor, die regelt die Cloud.
 *  - Maeh-Aufgaben, die in den naechsten drei Stunden starten wuerden, obwohl
 *    Regen, nasses Gras, Kaelte oder Sturm angesagt sind → Vorschlag
 *    „Heute aussetzen“. Der Hub schaltet die Aufgabe dann ab und nach dem
 *    Zeitfenster automatisch wieder ein (Aarons Plan bleibt erhalten).
 *  - Maeher maeht, aber es regnet → Vorschlag „In die Station“.
 *  - Mammotion nicht verbunden → Knopf „Neu anmelden“.
 *
 * Geschaltet wird nur nach Aarons Tipp auf den Knopf. Einzige Automatik: die
 * vorher ausgesetzte Maeh-Aufgabe wieder einschalten.
 *
 * energyPlan() liefert die Vorschau (Wetter, Maehfenster, Bewaesserung,
 * laufende Verbraucher) fuer das Werkzeug energy_plan und den Tagesbericht.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CONFIG, log } from "../config.js";
import { hubEventsSince, recordHubEvent } from "../state.js";
import { irrigationPlans, liveStates, roomsPayload } from "../rooms.js";
import { mowerAction, mowerConfigured, mowerStatus, syncMowersSoon, type MowerStatus } from "../mower.js";
import { getForecast, weatherError, weatherText, type Forecast } from "../weather.js";
import { sendText, type TgButton } from "./telegram.js";
import {
  berlinDate,
  costHint,
  dryWindows,
  forgottenCandidate,
  hhmm,
  irrigationOutlook,
  mowVerdict,
  nextMowRun,
  rainingNow,
  trackForgotten,
  type DeviceView,
  type MowerTaskLite,
} from "./energy-rules.js";

type Offer = (label: string, tool: string, args: Record<string, unknown>, desc: string, ttlMs?: number) => TgButton;

const TICK_MS = 5 * 60_000;
const H = 3_600_000;
/** Vorschlaege bleiben so lange bestaetigbar. */
const OFFER_TTL_MS = 6 * H;
/** Gleichen Vorschlag fruehestens nach dieser Zeit wiederholen. */
const RESEND_MS = 6 * H;
/** So lange vor dem Start einer Maeh-Aufgabe pruefen wir das Wetter. */
const MOW_LOOKAHEAD_H = 3;
/** Kamera hat in den letzten 30 Minuten im Raum jemanden gesehen = belegt. */
const OCCUPIED_MS = 30 * 60_000;

interface MowSkip {
  mower: string;
  planId: string;
  taskName: string;
  reenableAt: string;
  tries: number;
}

interface EnergyStore {
  ignored: number[];
  skips: MowSkip[];
  sent: Record<string, number>;
}

export const ENERGY = {
  enabled: false,
  lastTickAt: null as string | null,
  suggestions: 0,
  lastError: null as string | null,
};

let store: EnergyStore = { ignored: [], skips: [], sent: {} };
const forgotten = new Map<number, number>();
let deps: { chatIds: () => string[]; offer: Offer } | null = null;

function storePath(): string {
  return path.join(CONFIG.hubDir, ".cache", "agent-energy.json");
}

async function load(): Promise<void> {
  try {
    const raw = JSON.parse(await readFile(storePath(), "utf8")) as Partial<EnergyStore>;
    store = {
      ignored: Array.isArray(raw.ignored) ? raw.ignored.filter((x) => typeof x === "number") : [],
      skips: Array.isArray(raw.skips) ? raw.skips : [],
      sent: raw.sent && typeof raw.sent === "object" ? raw.sent : {},
    };
  } catch {
    /* noch nichts gespeichert */
  }
}

async function save(): Promise<void> {
  // Alte Eintraege nicht ewig mitschleppen.
  const cut = Date.now() - 3 * 24 * H;
  for (const [k, t] of Object.entries(store.sent)) if (t < cut) delete store.sent[k];
  await mkdir(path.dirname(storePath()), { recursive: true });
  await writeFile(storePath(), JSON.stringify(store, null, 2), "utf8");
}

/** true, wenn der Vorschlag `key` jetzt (wieder) gesendet werden darf – und merkt ihn. */
function claim(key: string, resendMs = RESEND_MS): boolean {
  const last = store.sent[key] ?? 0;
  if (Date.now() - last < resendMs) return false;
  store.sent[key] = Date.now();
  return true;
}

async function suggest(text: string, buttons: TgButton[][]): Promise<void> {
  const ids = deps?.chatIds() ?? [];
  if (!ids.length) return;
  ENERGY.suggestions++;
  for (const id of ids) await sendText(id, text, buttons).catch((e) => log(`Energie: Senden an ${id}: ${e instanceof Error ? e.message : e}`));
}

/* ------------------------------------------------------------ Daten */

async function deviceViews(): Promise<DeviceView[]> {
  const p = roomsPayload();
  const live = await liveStates();
  const out: DeviceView[] = [];
  for (const r of p.rooms) {
    const managed = new Set<number>(
      r.climate?.isActive ? [...(r.climate.heaterDeviceIds ?? []), ...(r.climate.fanDeviceIds ?? [])] : []
    );
    for (const d of r.devices) {
      const st = live[d.id];
      if (!st) continue;
      out.push({
        id: d.id,
        name: d.name,
        room: r.name,
        roomId: r.id,
        category: d.category,
        type: d.type,
        on: st.on,
        powerW: st.powerW,
        roomOpen: r.operating ? r.operating.open : null,
        climateManaged: managed.has(d.id),
      });
    }
  }
  return out;
}

/** Hat eine Kamera des Raums in den letzten 30 Minuten eine Person gesehen? */
function roomOccupied(roomId: number, now: number): boolean {
  const room = roomsPayload().rooms.find((r) => r.id === roomId);
  const names = new Set(room?.cameras.map((c) => c.name) ?? []);
  if (!names.size) return false;
  return hubEventsSince(0, { kind: "person", limit: 300 }).some(
    (e) => e.where != null && names.has(e.where) && now - Date.parse(e.ts) < OCCUPIED_MS
  );
}

function mowerTasks(ms: MowerStatus): MowerTaskLite[] {
  return ms.mowers.flatMap((m) =>
    m.tasks.map((t) => ({
      mower: m.name,
      mowerLabel: m.label,
      id: t.id,
      name: t.name,
      enabled: t.enabled,
      startTime: t.startTime,
      endTime: t.endTime,
      weekdays: t.weekdays,
    }))
  );
}

/* ------------------------------------------------------------ Regeln anwenden */

async function checkForgotten(now: number): Promise<void> {
  const views = await deviceViews();
  for (const d of trackForgotten(forgotten, views, now)) {
    if (store.ignored.includes(d.id)) continue;
    if (roomOccupied(d.roomId, now)) {
      forgotten.set(d.id, now);
      continue;
    }
    if (!claim(`dev:${d.id}`)) continue;
    const mins = Math.round((now - (forgotten.get(d.id) ?? now)) / 60_000);
    const what = d.category === "BELEUCHTUNG" || d.type === "HUE_LIGHT" ? "Licht" : "Verbraucher";
    await suggest(
      `💡 ${what} „${d.name}“ (${d.room}) ist seit ${mins} min an, der Raum hat geschlossen und keine Kamera sieht dort jemanden${costHint(d.powerW, 12)}.\nAusschalten?`,
      [
        [
          deps!.offer("Ausschalten", "switch_device", { device: String(d.id), action: "deactivate" }, `${d.name} (${d.room}): ausschalten`, OFFER_TTL_MS),
          deps!.offer("Nicht mehr fragen", "energy_ignore_device", { device: d.id, ignore: true }, `${d.name}: nicht mehr als vergessen melden`, OFFER_TTL_MS),
        ],
      ]
    );
  }
}

async function checkMowers(fc: Forecast | null, ms: MowerStatus, now: Date): Promise<void> {
  if (!ms.configured) return;
  if (ms.state !== "ready") {
    if (["error", "retrying", "rejected"].includes(ms.state) && claim("mammotion:login", 12 * H)) {
      const rejected = ms.state === "rejected";
      await suggest(
        `🤖 Mammotion ist nicht verbunden (${ms.error ?? ms.state}). Ohne Verbindung kann ich die Mäher nicht nach dem Wetter planen.` +
          (rejected
            ? "\nMammotion lehnt das Passwort ab: Bitte in der Mammotion-App das Passwort des Hub-Accounts prüfen und in hub/.env (MAMMOTION_PASSWORD) eintragen."
            : "\nSoll ich die alte Sitzung verwerfen und mich einmal neu anmelden?"),
        rejected ? [] : [[deps!.offer("Neu anmelden", "mower_relogin", {}, "Mammotion neu anmelden", OFFER_TTL_MS)]]
      );
    }
    return;
  }
  if (!fc) return;
  for (const t of mowerTasks(ms)) {
    if (store.skips.some((s) => s.mower === t.mower && s.planId === t.id)) continue;
    const run = nextMowRun(t, now, MOW_LOOKAHEAD_H);
    if (!run || run.start.getTime() < now.getTime()) continue;
    const v = mowVerdict(fc.hours, run.start, run.end);
    if (v.ok || !claim(`mow:${t.mower}:${t.id}:${run.start.toISOString()}`, 24 * H)) continue;
    await suggest(
      `🌧 ${t.mowerLabel}: Aufgabe „${t.name}“ startet um ${hhmm(run.start)} Uhr, aber ${v.reasons.join(", ")}.\nHeute aussetzen? Ich schalte die Aufgabe nach ${hhmm(run.end)} Uhr wieder ein.`,
      [
        [
          deps!.offer(
            "Heute aussetzen",
            "mower_skip_task",
            { mower: t.mower, task: t.id, until: new Date(run.end.getTime() + H).toISOString() },
            `${t.mowerLabel}: „${t.name}“ heute aussetzen`,
            Math.max(10 * 60_000, run.start.getTime() - now.getTime())
          ),
        ],
      ]
    );
  }
  if (rainingNow(fc.hours, now)) {
    for (const m of ms.mowers.filter((x) => x.active && !x.charging)) {
      if (!claim(`mowrain:${m.name}`, 3 * H)) continue;
      await suggest(`🌧 ${m.label} mäht gerade (${m.statusLabel}), es regnet laut Wetterbericht.\nIn die Station schicken?`, [
        [deps!.offer("In die Station", "mower_action", { mower: m.name, action: "dock" }, `${m.label}: zurück in die Station`, H)],
      ]);
    }
  }
}

/** Ausgesetzte Maeh-Aufgaben nach ihrem Fenster wieder einschalten (feste Regel). */
async function reenableSkipped(now: number): Promise<void> {
  const due = store.skips.filter((s) => Date.parse(s.reenableAt) <= now);
  if (!due.length) return;
  for (const s of due) {
    const r = await mowerAction({ mower: s.mower, action: "enable_task", planId: s.planId, enabled: true });
    s.tries++;
    if (r.ok) {
      store.skips = store.skips.filter((x) => x !== s);
      log(`Energie: Mäh-Aufgabe „${s.taskName}“ (${s.mower}) wieder eingeschaltet`);
      recordHubEvent({ kind: "task", severity: "info", where: "Assistent", title: `Mäh-Aufgabe „${s.taskName}“ wieder eingeschaltet` });
    } else if (s.tries >= 12) {
      store.skips = store.skips.filter((x) => x !== s);
      await suggest(`⚠️ Mäh-Aufgabe „${s.taskName}“ (${s.mower}) konnte ich nicht wieder einschalten: ${r.error ?? "Fehler"}. Bitte in der Mammotion-App einschalten.`, []);
    }
  }
  syncMowersSoon();
  await save();
}

async function tick(): Promise<void> {
  const now = new Date();
  ENERGY.lastTickAt = now.toISOString();
  try {
    await checkForgotten(now.getTime());
    if (mowerConfigured()) {
      await reenableSkipped(now.getTime());
      const [fc, ms] = await Promise.all([getForecast(), mowerStatus()]);
      await checkMowers(fc, ms, now);
    }
    ENERGY.lastError = null;
  } catch (e) {
    ENERGY.lastError = e instanceof Error ? e.message : String(e);
    log(`Energie: ${ENERGY.lastError}`);
  }
  await save().catch(() => undefined);
}

/* ------------------------------------------------------------ Werkzeuge */

/** Maeh-Aufgabe abschalten und zum Zeitpunkt `until` automatisch wieder einschalten. */
export async function skipMowTask(mower: string, task: string, until?: string): Promise<{ ok: boolean; error?: string; reenableAt?: string }> {
  const ms = await mowerStatus();
  const m = ms.mowers.find((x) => x.name === mower || x.label.toLowerCase() === mower.toLowerCase());
  if (!m) return { ok: false, error: `Mäher „${mower}“ unbekannt` };
  const t = m.tasks.find((x) => x.id === task || x.name.toLowerCase() === task.toLowerCase());
  if (!t) return { ok: false, error: `Aufgabe „${task}“ unbekannt. Vorhanden: ${m.tasks.map((x) => x.name).join(", ") || "keine"}` };
  if (!t.enabled) return { ok: false, error: `„${t.name}“ ist schon ausgeschaltet` };
  let reenable = until ? new Date(until) : null;
  if (!reenable || Number.isNaN(reenable.getTime())) {
    const run = nextMowRun({ ...t, mower: m.name, mowerLabel: m.label }, new Date());
    reenable = new Date((run?.end.getTime() ?? Date.now() + 12 * H) + H);
  }
  const r = await mowerAction({ mower: m.name, action: "enable_task", planId: t.id, enabled: false });
  if (!r.ok) return r;
  store.skips = store.skips.filter((s) => !(s.mower === m.name && s.planId === t.id));
  store.skips.push({ mower: m.name, planId: t.id, taskName: t.name, reenableAt: reenable.toISOString(), tries: 0 });
  await save();
  syncMowersSoon();
  return { ok: true, reenableAt: reenable.toISOString() };
}

export async function setDeviceIgnored(id: number, ignore: boolean): Promise<{ ok: boolean; ignored: number[] }> {
  store.ignored = store.ignored.filter((x) => x !== id);
  if (ignore) store.ignored.push(id);
  await save();
  return { ok: true, ignored: store.ignored };
}

const fmtDay = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", weekday: "short", day: "numeric", month: "numeric" });

/** Vorschau fuer heute und morgen: Wetter, Maehen, Bewaesserung, Verbraucher. */
export async function energyPlan(): Promise<Record<string, unknown>> {
  const now = new Date();
  const [fc, ms, views] = await Promise.all([getForecast(), mowerConfigured() ? mowerStatus() : Promise.resolve(null), deviceViews()]);
  const today = berlinDate(now);
  const tomorrow = berlinDate(new Date(now.getTime() + 24 * H));
  const days = (fc?.days ?? []).filter((d) => d.date === today || d.date === tomorrow);

  const mowing = ms?.state === "ready" && fc
    ? mowerTasks(ms)
        .map((t) => {
          const run = nextMowRun(t, now);
          if (!run) return null;
          const v = mowVerdict(fc.hours, run.start, run.end);
          return {
            mower: t.mowerLabel,
            task: t.name,
            start: `${fmtDay(berlinDate(run.start))} ${hhmm(run.start)}`,
            ok: v.ok,
            why: v.reasons,
            suspendedUntil: store.skips.find((s) => s.mower === t.mower && s.planId === t.id)?.reenableAt ?? null,
          };
        })
        .filter(Boolean)
    : [];
  const endOfTomorrow = new Date(now.getTime() + 48 * H);
  const windows = fc
    ? dryWindows(fc.hours, now, endOfTomorrow).map((w) => `${fmtDay(berlinDate(w.start))} ${hhmm(w.start)}–${hhmm(w.end)}`)
    : [];
  const plans = irrigationPlans();
  const irrigation = [today, tomorrow].flatMap((date) =>
    irrigationOutlook(plans, fc?.days.find((d) => d.date === date), date).map((o) => ({ day: fmtDay(date), ...o }))
  );
  const onWhileClosed = views
    .filter(forgottenCandidate)
    .map((d) => ({
      device: d.name,
      room: d.room,
      powerW: d.powerW,
      sinceMin: forgotten.has(d.id) ? Math.round((now.getTime() - forgotten.get(d.id)!) / 60_000) : 0,
      ignored: store.ignored.includes(d.id),
    }));
  const heating = roomsPayload()
    .rooms.filter((r) => r.climate?.isActive)
    .map((r) => ({
      room: r.name,
      open: r.operating?.open ?? null,
      tempC: r.climate!.lastTempC,
      targetC: r.climate!.currentTargetC,
      heating: r.climate!.heating,
      preheatMin: r.climate!.preheatMinutes ?? null,
    }));
  const frost = days.find((d) => d.tMin != null && d.tMin <= 0);
  return {
    weather: fc
      ? {
          now: fc.current ? `${fc.current.tempC} °C, ${weatherText(fc.current.code)}` : null,
          days: days.map((d) => ({
            day: fmtDay(d.date),
            text: weatherText(d.code),
            tMin: d.tMin,
            tMax: d.tMax,
            rainMm: d.precipMm,
            rainProb: d.precipProb,
          })),
          location: fc.location.source,
        }
      : { error: weatherError() ?? "kein Wetterbericht" },
    mammotion: ms ? { state: ms.state, error: ms.error } : "nicht eingerichtet",
    mowing,
    dryWindowsForMowing: windows,
    irrigation,
    irrigationPlansKnown: plans.length,
    heating,
    frostHint: frost
      ? `Frost ${fmtDay(frost.date)} (${Math.round(frost.tMin!)} °C): Frostschutz der Heizungen prüfen, Außenleitungen und Bewässerung entleeren.`
      : null,
    devicesOnWhileClosed: onWhileClosed,
    pendingMowSkips: store.skips.map((s) => ({ task: s.taskName, mower: s.mower, reenableAt: s.reenableAt })),
    rules:
      "Vorschläge kommen per Telegram mit Knopf. Automatisch nur: ausgesetzte Mäh-Aufgaben nach dem Zeitfenster wieder einschalten. Heizung und Lüftung regelt die Cloud-Klimaregelung.",
  };
}

/* ------------------------------------------------------------ Start */

export async function startEnergy(d: { chatIds: () => string[]; offer: Offer }): Promise<void> {
  deps = d;
  await load();
  ENERGY.enabled = true;
  log(`Energie: Wächter an (${store.ignored.length} ignorierte Geräte, ${store.skips.length} ausgesetzte Mäh-Aufgaben)`);
  // Erst nach dem Laden von Raeumen und Maeher-Dienst loslegen.
  setTimeout(() => void tick(), 90_000);
  setInterval(() => void tick(), TICK_MS);
}
