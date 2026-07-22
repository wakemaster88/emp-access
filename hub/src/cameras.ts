/**
 * Kamera-Modul: spricht Reolink-Kameras ueber die lokale CGI-HTTP-API an
 * (POST /cgi-bin/api.cgi). Pollt Bewegungs-/KI-Zustaende (GetMdState/
 * GetAiState), meldet Start/Ende der Ereignisse an die Cloud und laedt
 * Schnappschuesse hoch (bei Ereignis-Beginn und auf Task-Anforderung).
 */
import { api, log } from "./config.js";
import { STATE } from "./state.js";
import { embedJpeg, matchEmbedding, refreshGallery } from "./face.js";
import { jpegContainsVehicle } from "./vision.js";

export interface CameraConfig {
  id: number;
  name: string;
  host: string;
  httpPort: number;
  https: boolean;
  username: string;
  password: string;
  channel: number;
}

interface CameraRuntime {
  config: CameraConfig;
  token: string | null;
  tokenExpiresAt: number;
  /** Aktueller Alarm-Zustand pro Ereignistyp (fuer Flankenerkennung). */
  states: Record<string, boolean>;
  lastSnapshotAt: number;
  unreachableLogged: boolean;
}

const cameras = new Map<number, CameraRuntime>();
let configLoadedAt = 0;

const CONFIG_REFRESH_MS = 60_000;
const TOKEN_SAFETY_MS = 60_000;
/** Bei Ereignis-Beginn hoechstens alle 30 s ein Auto-Snapshot pro Kamera. */
const EVENT_SNAPSHOT_THROTTLE_MS = 30_000;
/** Personen: kurz warten, dann mehrere Versuche solange PERSON aktiv (Gesicht oft erst frontal). */
const PERSON_SNAP_DELAY_MS = 1_000;
const PERSON_SNAP_ATTEMPTS = 4;
const PERSON_SNAP_RETRY_MS = 1_200;
/**
 * Fahrzeuge: sofort Burst-Snaps ab Event-Start, danach optional Vision.
 * Vision nur auf Spam-/Weitwinkel-Kameras – Zufahrt vertraut Reolink.
 * Wichtig: ersten Frame bevorzugen (mittlerer/letzter = oft zu spät).
 */
const VEHICLE_SNAP_DELAY_MS = 0;
const VEHICLE_BURST_COUNT = 3;
const VEHICLE_BURST_GAP_MS = 350;

/**
 * Ob llava das JPEG prüfen muss. Weitwinkel (Seilbahn/Aquapark) = ja.
 * Zufahrt/Nähe = nein (Reolink VEHICLE reicht; llava war zu streng).
 * Override: HUB_VEHICLE_VISION=always|never|auto (Default auto).
 */
function vehicleNeedsVision(cam: CameraConfig): boolean {
  const mode = (process.env.HUB_VEHICLE_VISION || "auto").toLowerCase();
  if (mode === "always") return true;
  if (mode === "never") return false;
  const name = cam.name.toLowerCase();
  if (/seilbahn|aquapark/.test(name)) return true;
  if (/eingang|halle|insel|shop|drehkreuz|gastro|umkleide/.test(name)) return false;
  return true;
}

function baseUrl(c: CameraConfig): string {
  return `${c.https ? "https" : "http"}://${c.host}:${c.httpPort}`;
}

/** CGI-Kommando ausfuehren; Reolink erwartet ein Array von Kommandos. */
async function cgi(
  cam: CameraRuntime,
  cmd: string,
  param: Record<string, unknown>,
  { withToken = true }: { withToken?: boolean } = {}
): Promise<Record<string, unknown>> {
  const qs = withToken && cam.token ? `&token=${encodeURIComponent(cam.token)}` : "";
  const res = await fetch(`${baseUrl(cam.config)}/cgi-bin/api.cgi?cmd=${cmd}${qs}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ cmd, action: 0, param }]),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as Array<{
    code: number;
    value?: Record<string, unknown>;
    error?: { rspCode?: number; detail?: string };
  }>;
  const first = json?.[0];
  if (!first || first.code !== 0) {
    const rsp = first?.error?.rspCode;
    // Token abgelaufen/ungueltig -> beim naechsten Versuch neu einloggen.
    if (rsp === -6 || rsp === -1) {
      cam.token = null;
      cam.tokenExpiresAt = 0;
    }
    throw new Error(`${cmd} fehlgeschlagen: ${first?.error?.detail ?? "unbekannt"} (rspCode ${rsp})`);
  }
  return first.value ?? {};
}

async function ensureLogin(cam: CameraRuntime): Promise<void> {
  if (cam.token && Date.now() < cam.tokenExpiresAt) return;
  const value = await cgi(
    cam,
    "Login",
    { User: { userName: cam.config.username, password: cam.config.password } },
    { withToken: false }
  );
  const token = (value.Token as { name?: string; leaseTime?: number } | undefined);
  if (!token?.name) throw new Error("Login ohne Token beantwortet");
  cam.token = token.name;
  cam.tokenExpiresAt = Date.now() + ((token.leaseTime ?? 3600) * 1000 - TOKEN_SAFETY_MS);
}

/**
 * Alarm-Zustaende abfragen. GetAiState liefert je nach Modell people/vehicle/
 * dog_cat; GetMdState die klassische Bewegungserkennung.
 */
/**
 * Versucht ein Kennzeichen aus der Reolink-AI zu lesen. Viele Modelle liefern
 * nur die Klasse "vehicle" ohne Plate – dann bleibt der Rueckgabewert null.
 */
async function tryReadPlate(cam: CameraRuntime): Promise<string | null> {
  try {
    await ensureLogin(cam);
    const ai = await cgi(cam, "GetAiState", { channel: cam.config.channel });
    const candidates: unknown[] = [
      ai.plate_num,
      ai.plate,
      ai.license_plate,
      (ai.vehicle as { plate?: string } | undefined)?.plate,
      (ai.vehicle as { plate_num?: string } | undefined)?.plate_num,
    ];
    for (const c of candidates) {
      if (typeof c === "string" && c.trim().length >= 2) return c.trim().toUpperCase();
    }
  } catch {
    // Kein LPR / aelteres Modell.
  }
  return null;
}

async function pollStates(cam: CameraRuntime): Promise<Record<string, boolean>> {
  await ensureLogin(cam);
  const channel = cam.config.channel;
  const states: Record<string, boolean> = {};

  const md = await cgi(cam, "GetMdState", { channel });
  states.MOTION = Number(md.state) === 1;

  try {
    const ai = await cgi(cam, "GetAiState", { channel });
    const map: Record<string, string> = { people: "PERSON", vehicle: "VEHICLE", dog_cat: "ANIMAL" };
    for (const [key, type] of Object.entries(map)) {
      const entry = ai[key] as { alarm_state?: number; support?: number } | undefined;
      if (entry?.support === 1) states[type] = entry.alarm_state === 1;
    }
    // Klare Gesichtserkennung (falls Modell face liefert) ueberschreibt PERSON.
    const face = ai.face as { alarm_state?: number; support?: number } | undefined;
    if (face?.support === 1) {
      states.PERSON = face.alarm_state === 1;
    }
  } catch {
    // Aeltere Modelle ohne KI-Erkennung - nur Bewegung melden.
  }
  return states;
}

/** JPEG von der Kamera holen (ohne Upload). */
async function captureSnap(cam: CameraRuntime): Promise<Buffer> {
  await ensureLogin(cam);
  const rs = Math.random().toString(36).slice(2, 10);
  const res = await fetch(
    `${baseUrl(cam.config)}/cgi-bin/api.cgi?cmd=Snap&channel=${cam.config.channel}&rs=${rs}&token=${encodeURIComponent(cam.token!)}`,
    { signal: AbortSignal.timeout(15000) }
  );
  if (!res.ok) throw new Error(`Snap fehlgeschlagen: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    throw new Error("Snap lieferte kein JPEG (falsche Zugangsdaten?)");
  }
  return buf;
}

/** Schnappschuss von der Kamera holen und in die Cloud laden. */
export async function uploadSnapshot(cameraId: number): Promise<{ bytes: number }> {
  const cam = cameras.get(cameraId);
  if (!cam) throw new Error(`Kamera ${cameraId} nicht konfiguriert (oder deaktiviert)`);

  const buf = await captureSnap(cam);
  const upload = await api(`/api/hub/cameras/${cameraId}/snapshot`, {
    method: "POST",
    headers: { "Content-Type": "image/jpeg" },
    body: buf,
  });
  if (!upload.ok) throw new Error(`Snapshot-Upload fehlgeschlagen: HTTP ${upload.status}`);
  cam.lastSnapshotAt = Date.now();
  return { bytes: buf.length };
}

/**
 * Bei Personen-Erkennung: Delay, dann bis zu N Snap-/Face-Versuche solange
 * PERSON noch aktiv – Gallery-Match, Upload (ohne Gesicht: kein Upload).
 */
async function uploadPersonSnapshot(cameraId: number): Promise<{ bytes: number } | null> {
  const cam = cameras.get(cameraId);
  if (!cam) throw new Error(`Kamera ${cameraId} nicht konfiguriert (oder deaktiviert)`);

  await new Promise((r) => setTimeout(r, PERSON_SNAP_DELAY_MS));

  let buf: Buffer | null = null;
  let face: Awaited<ReturnType<typeof embedJpeg>> = null;

  for (let attempt = 1; attempt <= PERSON_SNAP_ATTEMPTS; attempt++) {
    try {
      const states = await pollStates(cam);
      cam.states.PERSON = states.PERSON ?? false;
      if (!states.PERSON) {
        log(
          `Personen-Snapshot ${cam.config.name}: übersprungen (nicht mehr aktiv` +
            (attempt > 1 ? `, nach Versuch ${attempt - 1}` : "") +
            `)`
        );
        return null;
      }
    } catch (e) {
      log(
        `Personen-Snapshot ${cam.config.name}: Re-Check fehlgeschlagen: ${
          e instanceof Error ? e.message : e
        }`
      );
      return null;
    }

    buf = await captureSnap(cam);
    face = await embedJpeg(buf);
    if (face) {
      if (attempt > 1) {
        log(`Personen-Snapshot ${cam.config.name}: Gesicht erst bei Versuch ${attempt}`);
      }
      break;
    }
    log(
      `Personen-Snapshot ${cam.config.name}: Versuch ${attempt}/${PERSON_SNAP_ATTEMPTS} ohne Gesicht`
    );
    if (attempt < PERSON_SNAP_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, PERSON_SNAP_RETRY_MS));
    }
  }

  if (!buf || !face) {
    log(
      `Personen-Snapshot ${cam.config.name}: übersprungen (kein Gesicht nach ${PERSON_SNAP_ATTEMPTS} Versuchen)`
    );
    return null;
  }

  await refreshGallery();
  const match = matchEmbedding(face.embedding);
  const qs = new URLSearchParams({ cameraId: String(cameraId) });
  if (match) {
    qs.set("listedPersonId", String(match.listedPersonId));
    qs.set("matchScore", match.score.toFixed(4));
    qs.set("matchMethod", "FACE_EMBEDDING");
    log(
      `Personen-Snapshot ${cam.config.name}: Match „${match.name}“ score=${match.score.toFixed(3)}`
    );
  } else {
    log(
      `Personen-Snapshot ${cam.config.name}: klares Gesicht (det=${face.detScore.toFixed(2)}), kein Gallery-Match`
    );
  }

  const upload = await api(`/api/hub/person-sightings?${qs}`, {
    method: "POST",
    headers: { "Content-Type": "image/jpeg" },
    body: new Uint8Array(buf),
    signal: AbortSignal.timeout(60_000),
  });
  if (!upload.ok) {
    const errText = await upload.text().catch(() => "");
    throw new Error(
      `Personen-Snapshot fehlgeschlagen: HTTP ${upload.status} ${errText.slice(0, 120)}`
    );
  }
  log(`Personen-Snapshot ${cam.config.name}: Upload OK (${buf.length} bytes)`);
  cam.lastSnapshotAt = Date.now();
  return { bytes: buf.length };
}

/**
 * Fahrzeug-Erkennung: kurzer Delay, Burst-Snaps solange VEHICLE aktiv,
 * optional llava (nur Spam-/Weitwinkel-Kameras), dann Upload.
 */
async function uploadVehicleSnapshot(cameraId: number): Promise<{ bytes: number } | null> {
  const cam = cameras.get(cameraId);
  if (!cam) throw new Error(`Kamera ${cameraId} nicht konfiguriert (oder deaktiviert)`);

  await new Promise((r) => setTimeout(r, VEHICLE_SNAP_DELAY_MS));

  const snaps: Buffer[] = [];
  for (let i = 0; i < VEHICLE_BURST_COUNT; i++) {
    try {
      const states = await pollStates(cam);
      cam.states.VEHICLE = states.VEHICLE ?? false;
      if (!states.VEHICLE) {
        if (snaps.length === 0) {
          log(`Fahrzeug-Snapshot ${cam.config.name}: übersprungen (nicht mehr aktiv)`);
          return null;
        }
        break;
      }
    } catch (e) {
      if (snaps.length === 0) {
        log(
          `Fahrzeug-Snapshot ${cam.config.name}: Re-Check fehlgeschlagen: ${
            e instanceof Error ? e.message : e
          }`
        );
        return null;
      }
      break;
    }

    snaps.push(await captureSnap(cam));
    if (i < VEHICLE_BURST_COUNT - 1) {
      await new Promise((r) => setTimeout(r, VEHICLE_BURST_GAP_MS));
    }
  }

  if (snaps.length === 0) {
    log(`Fahrzeug-Snapshot ${cam.config.name}: übersprungen (kein Snap)`);
    return null;
  }

  const needVision = vehicleNeedsVision(cam.config);
  let buf: Buffer | null = null;

  if (!needVision) {
    // Erster Frame = nah am VEHICLE-Start. Mittel/Ende war oft leere Szene
    // oder Auto schon aus dem Bild (z.B. Eingang/Halle heute früh).
    buf = snaps[0];
    log(
      `Fahrzeug-Snapshot ${cam.config.name}: Reolink vertraut – Frame 1/${snaps.length} (Event-Start)`
    );
  } else {
    log(
      `Fahrzeug-Snapshot ${cam.config.name}: Vision auf ${snaps.length} Burst-Snap(s) …`
    );
    for (let i = 0; i < snaps.length; i++) {
      const ok = await jpegContainsVehicle(snaps[i]);
      if (ok === true) {
        buf = snaps[i];
        log(`Fahrzeug-Snapshot ${cam.config.name}: Vision YES (Frame ${i + 1}/${snaps.length})`);
        break;
      }
      log(
        `Fahrzeug-Snapshot ${cam.config.name}: Vision Frame ${i + 1}/${snaps.length} → ${
          ok === false ? "NO" : "?"
        }`
      );
    }
    if (!buf) {
      log(
        `Fahrzeug-Snapshot ${cam.config.name}: übersprungen (Vision: kein Fahrzeug in ${snaps.length} Frames)`
      );
      return null;
    }
  }

  const plate = await tryReadPlate(cam);
  const qs = new URLSearchParams({ cameraId: String(cameraId) });
  if (plate) {
    qs.set("plate", plate);
    log(`Fahrzeug-Snapshot ${cam.config.name}: Kennzeichen ${plate}`);
  } else {
    log(`Fahrzeug-Snapshot ${cam.config.name}: kein Kennzeichen – manuelles Mapping`);
  }

  const upload = await api(`/api/hub/vehicle-sightings?${qs}`, {
    method: "POST",
    headers: { "Content-Type": "image/jpeg" },
    body: new Uint8Array(buf),
    signal: AbortSignal.timeout(60_000),
  });
  if (!upload.ok) {
    const errText = await upload.text().catch(() => "");
    throw new Error(
      `Fahrzeug-Snapshot fehlgeschlagen: HTTP ${upload.status} ${errText.slice(0, 120)}`
    );
  }
  log(`Fahrzeug-Snapshot ${cam.config.name}: Upload OK (${buf.length} bytes)`);
  cam.lastSnapshotAt = Date.now();
  return { bytes: buf.length };
}

async function refreshConfigs(): Promise<void> {
  const res = await api("/api/hub/cameras");
  if (!res.ok) throw new Error(`Kamera-Konfig-Abruf fehlgeschlagen: HTTP ${res.status}`);
  const configs = (await res.json()) as CameraConfig[];

  const ids = new Set(configs.map((c) => c.id));
  for (const id of cameras.keys()) {
    if (!ids.has(id)) cameras.delete(id);
  }
  for (const config of configs) {
    const existing = cameras.get(config.id);
    if (existing) {
      // Bei geaenderten Zugangsdaten/Adresse Token verwerfen.
      const changed = JSON.stringify(existing.config) !== JSON.stringify(config);
      existing.config = config;
      if (changed) {
        existing.token = null;
        existing.tokenExpiresAt = 0;
      }
    } else {
      cameras.set(config.id, {
        config,
        token: null,
        tokenExpiresAt: 0,
        states: {},
        lastSnapshotAt: 0,
        unreachableLogged: false,
      });
    }
  }
  configLoadedAt = Date.now();
}

let pollBusy = false;

/** Haupt-Loop: Konfiguration aktuell halten, Zustaende pollen, Events melden. */
export async function pollCameras(): Promise<void> {
  if (pollBusy) return;
  pollBusy = true;
  try {
    if (Date.now() - configLoadedAt > CONFIG_REFRESH_MS) {
      await refreshConfigs();
    }
    if (cameras.size === 0) {
      STATE.cameras = { lastPollAt: new Date().toISOString(), configured: 0, reachable: 0, openEvents: 0, error: null };
      return;
    }

    const events: {
      cameraId: number;
      type: string;
      phase: "start" | "end";
      at: string;
      plate?: string;
    }[] = [];
    const seen: number[] = [];
    const now = new Date().toISOString();
    const snapshotJobs: number[] = [];
    const personSnapshotJobs: number[] = [];
    const vehicleSnapshotJobs: number[] = [];

    for (const cam of cameras.values()) {
      try {
        const states = await pollStates(cam);
        seen.push(cam.config.id);
        cam.unreachableLogged = false;

        for (const [type, active] of Object.entries(states)) {
          const was = cam.states[type] ?? false;
          if (active && !was) {
            events.push({
              cameraId: cam.config.id,
              type,
              phase: "start",
              at: now,
            });
            if (Date.now() - cam.lastSnapshotAt > EVENT_SNAPSHOT_THROTTLE_MS) {
              if (type === "PERSON") personSnapshotJobs.push(cam.config.id);
              else if (type === "VEHICLE") vehicleSnapshotJobs.push(cam.config.id);
              else snapshotJobs.push(cam.config.id);
            }
          } else if (!active && was) {
            events.push({ cameraId: cam.config.id, type, phase: "end", at: now });
          }
          cam.states[type] = active;
        }
      } catch (e) {
        if (!cam.unreachableLogged) {
          log(`Kamera ${cam.config.name}: ${e instanceof Error ? e.message : e}`);
          cam.unreachableLogged = true;
        }
      }
    }

    if (events.length > 0 || seen.length > 0) {
      const res = await api("/api/hub/camera-events", {
        method: "POST",
        body: JSON.stringify({ events, seen }),
      });
      if (!res.ok) log(`Kamera-Event-Upload fehlgeschlagen: HTTP ${res.status}`);
      for (const e of events) {
        const cam = cameras.get(e.cameraId);
        log(`Kamera ${cam?.config.name ?? e.cameraId}: ${e.type} ${e.phase === "start" ? "erkannt" : "beendet"}`);
      }
    }

    for (const cameraId of [...new Set(personSnapshotJobs)]) {
      uploadPersonSnapshot(cameraId).catch((e) =>
        log(`Personen-Snapshot Kamera ${cameraId} fehlgeschlagen: ${e instanceof Error ? e.message : e}`)
      );
    }

    for (const cameraId of [...new Set(vehicleSnapshotJobs)]) {
      uploadVehicleSnapshot(cameraId).catch((e) =>
        log(`Fahrzeug-Snapshot Kamera ${cameraId} fehlgeschlagen: ${e instanceof Error ? e.message : e}`)
      );
    }

    for (const cameraId of [...new Set(snapshotJobs)]) {
      if (personSnapshotJobs.includes(cameraId) || vehicleSnapshotJobs.includes(cameraId)) continue;
      uploadSnapshot(cameraId).catch((e) =>
        log(`Auto-Snapshot Kamera ${cameraId} fehlgeschlagen: ${e instanceof Error ? e.message : e}`)
      );
    }

    const openEvents = [...cameras.values()].reduce(
      (sum, c) => sum + Object.values(c.states).filter(Boolean).length,
      0
    );
    STATE.cameras = {
      lastPollAt: new Date().toISOString(),
      configured: cameras.size,
      reachable: seen.length,
      openEvents,
      error: null,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    STATE.cameras = {
      lastPollAt: new Date().toISOString(),
      configured: cameras.size,
      reachable: 0,
      openEvents: 0,
      error: msg,
    };
    log(`Kamera-Poll-Fehler: ${msg}`);
  } finally {
    pollBusy = false;
  }
}

export const CAMERA_POLL_INTERVAL_MS = (() => {
  const n = Number(process.env.HUB_CAMERA_POLL_INTERVAL);
  return (Number.isFinite(n) && n >= 2 ? n : 5) * 1000;
})();
