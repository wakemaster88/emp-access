import { loadConfig } from "./config";
import {
  fetchCrossingSnapshot,
  fetchRecentCrossings,
  type CrossingEvent,
} from "./people-tracker";
import { fetchScanRows, type ScanRow } from "./emp-access-scans";
import { archiveScans } from "./scan-archive";
import { pairCrossings, MAX_LAG_MS } from "./tailgate-pairing";
import { publishTailgatePass } from "./event-bus";
import { postShopAlert, type ShopAlertImage } from "./emp-access-alert";
import { logEvent } from "./audit";
import type { Cam } from "./types";

/**
 * Sofortmeldung: „da ist gerade jemand ohne gültigen Scan durchgegangen".
 *
 * Der Fenster-Abgleich in `tailgate.ts` beantwortet eine andere Frage —
 * stimmt die Bilanz über zehn Minuten? Der ist bewusst träge, damit
 * Zählfehler nicht dauernd Alarm auslösen. Für „jemand steht noch am
 * Drehkreuz, geh hin" ist er zu langsam.
 *
 * Hier wird deshalb Durchgang für Durchgang geprüft, mit derselben Paarung
 * wie in der Auswertung, aber erst nachdem eine Karenzzeit verstrichen ist:
 * Der Scan liegt in der Cloud, und bis wir ihn sehen, vergehen ein paar
 * Sekunden. Ohne Karenz würde jeder ganz normale Durchgang zuerst als
 * ungedeckt gelten.
 */

const TICK_MS = 6_000;

/**
 * Wie lange ein Durchgang auf seinen Scan warten darf, bevor er als
 * ungedeckt gilt. Setzt sich zusammen aus dem erlaubten Nachlauf der Paarung
 * (3 s) und der Zeit, die ein Scan braucht, bis er über die Cloud bei uns
 * ankommt (gemessen 3 bis 5 s). Der Rest ist Reserve.
 */
const GRACE_MS = 12_000;

/** Zeitraum, über den gepaart wird — mehr als genug für den Nachlauf. */
const LOOKBACK_MS = 5 * 60_000;

const SCAN_FETCH_LIMIT = 100;
const CROSSING_FETCH_LIMIT = 200;

/**
 * Mindestabstand zwischen zwei Popups auf dem Kassen-Monitor. Der Ton im
 * Kontrollzentrum kommt bei jedem Vorfall; ein Popup, das jemand wegklicken
 * muss, darf sich bei einer Gruppe nicht stapeln.
 */
const POPUP_COOLDOWN_MS = 60_000;

/** Mehr Blickwinkel passen auf dem Kassen-Monitor nicht nebeneinander. */
const MAX_ALERT_IMAGES = 2;

/**
 * Holt die Bilder zum Vorfall beim Tracker.
 *
 * An der Kasse nützt „jemand ist durchgegangen" wenig — die Frage ist, wer.
 * Der eigene Blick zeigt den Durchgang selbst, die Zusatzkamera meist das
 * Gesicht. Fehlt ein Bild, geht die Meldung trotzdem raus.
 */
export async function collectAlertImages(
  cam: Cam,
  crossing: CrossingEvent,
  camName: (id: string) => string,
): Promise<ShopAlertImage[]> {
  const images: ShopAlertImage[] = [];
  if (crossing.snap) {
    const own = await fetchCrossingSnapshot(cam.id, crossing.ts);
    if (own) images.push({ label: cam.name, jpeg: own });
  }
  for (const src of crossing.ctx) {
    if (images.length >= MAX_ALERT_IMAGES) break;
    const img = await fetchCrossingSnapshot(cam.id, crossing.ts, src);
    if (img) images.push({ label: camName(src), jpeg: img });
  }
  return images;
}

interface State {
  timer: ReturnType<typeof setInterval> | null;
  running: boolean;
  /** Bereits gemeldete Durchgänge je Kamera, als Zeitstempel. */
  reported: Map<string, Set<number>>;
  /** Ab wann gemeldet wird — verhindert eine Salve beim Serverstart. */
  baseline: Map<string, number>;
  lastPopupAt: Map<string, number>;
  /** Vorfälle seit dem letzten Popup, damit die Meldung sie mitzählt. */
  sincePopup: Map<string, number>;
}

declare global {
  var __webcams_tailgate_live: State | undefined;
}

function getState(): State {
  if (!globalThis.__webcams_tailgate_live) {
    globalThis.__webcams_tailgate_live = {
      timer: null,
      running: false,
      reported: new Map(),
      baseline: new Map(),
      lastPopupAt: new Map(),
      sincePopup: new Map(),
    };
  }
  return globalThis.__webcams_tailgate_live;
}

async function checkCam(
  cam: Cam,
  scans: ScanRow[],
  camName: (id: string) => string,
): Promise<void> {
  const state = getState();
  const now = Date.now();
  const horizon = now - LOOKBACK_MS;
  const cutoff = now - GRACE_MS;

  // Beim ersten Durchlauf nur nach vorn schauen. Sonst meldete ein Neustart
  // des Servers alle ungedeckten Durchgänge der letzten Minuten auf einmal.
  let baseline = state.baseline.get(cam.id);
  if (baseline === undefined) {
    baseline = now;
    state.baseline.set(cam.id, baseline);
  }

  const devices = new Set(cam.tailgate.deviceIds);
  const granted = scans.filter(
    (s) =>
      s.result === "GRANTED" &&
      s.deviceId !== null &&
      devices.has(s.deviceId) &&
      s.ts >= horizon - MAX_LAG_MS,
  );

  const crossings = (await fetchRecentCrossings(cam.id, CROSSING_FETCH_LIMIT))
    .filter((c) => c.dir === cam.tailgate.countDirection && c.ts >= horizon);

  let reported = state.reported.get(cam.id);
  if (!reported) {
    reported = new Set();
    state.reported.set(cam.id, reported);
  }
  for (const ts of reported) if (ts < horizon) reported.delete(ts);

  const { results } = pairCrossings(crossings, granted);
  const fresh = results
    .filter(
      (r) =>
        r.scan === null &&
        r.crossing.ts <= cutoff &&
        r.crossing.ts > baseline &&
        !reported!.has(r.crossing.ts),
    )
    .map((r) => r.crossing);

  if (fresh.length === 0) return;
  for (const c of fresh) reported.add(c.ts);

  const newestCrossing = fresh.reduce((a, b) => (b.ts > a.ts ? b : a));
  const newest = newestCrossing.ts;
  publishTailgatePass({
    source: cam.id,
    camId: cam.id,
    camName: cam.name,
    crossedAt: newest,
    count: fresh.length,
  });

  await logEvent({
    action: "tailgate-pass",
    target: cam.id,
    ok: false,
    meta: { count: fresh.length, crossedAt: new Date(newest).toISOString() },
  });

  if (!cam.tailgate.notifyShopMonitor) return;
  const pending = (state.sincePopup.get(cam.id) ?? 0) + fresh.length;
  state.sincePopup.set(cam.id, pending);
  if (now - (state.lastPopupAt.get(cam.id) ?? 0) < POPUP_COOLDOWN_MS) return;
  state.lastPopupAt.set(cam.id, now);
  state.sincePopup.set(cam.id, 0);

  try {
    await postShopAlert({
      camName: cam.name,
      count: pending,
      crossedAt: newest,
      images: await collectAlertImages(cam, newestCrossing, camName),
    });
  } catch (e) {
    console.warn("[tailgate-live] Popup fehlgeschlagen", (e as Error).message);
  }
}

async function tick(): Promise<void> {
  const state = getState();
  if (state.running) return;
  state.running = true;
  try {
    const cfg = await loadConfig();
    const cams = cfg.cams.filter(
      (c) =>
        c.enabled &&
        c.tailgate.enabled &&
        c.tailgate.instantAlert &&
        c.peopleCounter.enabled &&
        c.peopleCounter.mode === "crossing" &&
        c.tailgate.deviceIds.length > 0,
    );
    for (const id of state.baseline.keys()) {
      if (!cams.some((c) => c.id === id)) state.baseline.delete(id);
    }
    if (cams.length === 0) return;

    const emp = cfg.settings.empAccess;
    const token = emp.apiToken?.trim() ?? "";
    if (!emp.enabled || !token) return;

    const scans = await fetchScanRows(emp.baseUrl, token, SCAN_FETCH_LIMIT);
    void archiveScans(scans);

    const namen = new Map(cfg.cams.map((c) => [c.id, c.name]));
    const camName = (id: string) => namen.get(id) ?? id;

    for (const cam of cams) {
      try {
        await checkCam(cam, scans, camName);
      } catch (e) {
        console.warn(
          `[tailgate-live] ${cam.id} fehlgeschlagen`,
          (e as Error).message,
        );
      }
    }
  } catch (e) {
    console.warn("[tailgate-live] Durchlauf fehlgeschlagen", (e as Error).message);
  } finally {
    state.running = false;
  }
}

export function ensureTailgateLiveStarted(): void {
  const state = getState();
  if (state.timer) return;
  state.timer = setInterval(() => void tick(), TICK_MS);
  void tick();
}
