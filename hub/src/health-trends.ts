/**
 * Verlaeufe fuer die Frueherkennung (agent/early-warning.ts): sammelt
 * Erreichbarkeit, Neustarts, Switch-Port-Fehler, Temperaturen, Plattenstand
 * und Anmeldefehler und haelt sie 7 Tage in hub/.cache/health-trends.json.
 *
 * Nur lesend: Kameras melden jeden Poll (cameras.ts), Switches jede
 * SNMP-Abfrage (snmp.ts), den Rest holt `sampleHealth` im Waechter-Takt.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { CONFIG, log } from "./config.js";
import {
  assessTrends,
  newHealthStore,
  pruneHealthStore,
  recordDisk,
  recordLink,
  recordPort,
  recordTemp,
  recordUptime,
  reviveHealthStore,
  setLogin,
  trendSummary,
  type HealthStore,
  type TrendSummary,
} from "./agent/early-warning.js";
import type { Finding } from "./agent/findings.js";
import type { SwitchSnapshot } from "./snmp.js";

let store: HealthStore = newHealthStore();
let loaded = false;
let saving = false;

function storePath(): string {
  return path.join(CONFIG.hubDir, ".cache", "health-trends.json");
}

export async function loadHealthTrends(): Promise<void> {
  try {
    store = reviveHealthStore(JSON.parse(await readFile(storePath(), "utf8")));
  } catch {
    /* noch kein Verlauf */
  }
  loaded = true;
}

async function save(): Promise<void> {
  if (!loaded || saving) return;
  saving = true;
  try {
    pruneHealthStore(store, Date.now());
    await mkdir(path.dirname(storePath()), { recursive: true });
    const tmp = `${storePath()}.tmp`;
    await writeFile(tmp, JSON.stringify(store), "utf8");
    await rename(tmp, storePath());
  } catch (e) {
    log(`Frueherkennung: Speichern fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
  } finally {
    saving = false;
  }
}

/* ------------------------------------------------------------ Einspeisen */

/** Ein Abfrageergebnis (Kamera-Poll, Shelly, DoorBird …). */
export function noteLink(key: string, label: string, kind: string, ok: boolean, error?: string | null): void {
  recordLink(store, key, label, kind, ok, Date.now(), error);
}

/** Nach jeder SNMP-Abfrage eines Switches (snap = null/alt bei Fehler). */
export function noteSwitchPoll(host: string, snap: SwitchSnapshot | null, error: string | null): void {
  const now = Date.now();
  const name = snap?.sysName || host;
  noteLink(`switch:${host}`, name, "switch", !error, error);
  if (error || !snap) return;
  const rebooted = snap.uptimeS != null ? recordUptime(store, `switch:${host}`, name, "Switch", snap.uptimeS, now) : false;
  for (const p of snap.ports) {
    if (p.inErrors == null && p.lastChange == null) continue;
    recordPort(
      store,
      `${host}:${p.number}`,
      `${name} Port ${p.number}`,
      { inErrors: p.inErrors ?? null, lastChange: p.lastChange ?? null, up: p.up },
      now,
      rebooted,
    );
  }
}

/** Waechter-Takt: alles, was nicht von selbst gemeldet wird. */
export async function sampleHealth(): Promise<void> {
  const now = Date.now();
  // Dynamische Imports: diese Module ziehen viel nach und sollen health-trends
  // nicht in Import-Zyklen verwickeln (snmp.ts -> health-trends.ts).
  const [{ STATE }, { listDoorbirdStatus }, { soundwebLinkStates }, { localShellyHosts }, { shellyStatus }, { systemMetrics }, { lastMowerStatus, mowerConfigured }] =
    await Promise.all([
      import("./state.js"),
      import("./doorbird.js"),
      import("./soundweb.js"),
      import("./rooms.js"),
      import("./shelly.js"),
      import("./system-metrics.js"),
      import("./mower.js"),
    ]);

  for (const d of listDoorbirdStatus()) noteLink(`doorbird:${d.id}`, d.name, "doorbird", d.connected);
  for (const l of soundwebLinkStates()) noteLink(`soundweb:${l.id}`, l.name, "soundweb", l.connected, l.lastError);

  // Cloud: Heartbeat laeuft alle 30 s; 401/403 heisst Hub-Token ungueltig.
  const hb = STATE.heartbeat;
  if (hb.lastAttemptAt) {
    noteLink("cloud", "EMP-Access", "cloud", !hb.lastError, hb.lastError);
    const authFail = hb.lastError && /\b(401|403)\b|unauthori|forbidden/i.test(hb.lastError);
    setLogin(store, "cloud", authFail ? { label: "Hub bei der Cloud (HUB_API_TOKEN)", error: hb.lastError! } : null, now);
  }

  // Mammotion: Anmeldung abgelehnt oder Login fehlgeschlagen.
  if (mowerConfigured()) {
    const m = lastMowerStatus();
    const bad = m && (m.state === "rejected" || (m.state === "error" && /anmeld|login|passw|token|auth/i.test(m.error ?? "")));
    setLogin(store, "mammotion", bad ? { label: "Mammotion (Mäher)", error: m!.error ?? m!.state } : null, now);
  } else {
    setLogin(store, "mammotion", null, now);
  }

  // Shellys: Erreichbarkeit, Neustarts, Geraetetemperatur, falsches Passwort.
  const hosts = localShellyHosts();
  let pwIssue: string | null = null;
  const queue = [...hosts];
  await Promise.all(
    Array.from({ length: Math.min(6, queue.length) }, async () => {
      for (let h = queue.shift(); h; h = queue.shift()) {
        try {
          const st = await shellyStatus(h.host);
          const t = Date.now();
          noteLink(`shelly:${h.host}`, h.label, "shelly", true);
          if (st.uptimeS != null) recordUptime(store, `shelly:${h.host}`, h.label, "Shelly", st.uptimeS, t);
          if (st.temperatureC != null) recordTemp(store, `shelly:${h.host}`, `Shelly ${h.label}`, st.temperatureC, t);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (/Passwort/i.test(msg)) pwIssue = msg;
          noteLink(`shelly:${h.host}`, h.label, "shelly", false, msg);
        }
      }
    }),
  );
  setLogin(store, "shelly", pwIssue ? { label: "Shellys (HUB_SHELLY_PASSWORD)", error: pwIssue } : null, now);

  // Mac selbst: Neustarts und Plattenstand.
  const m = systemMetrics();
  if (m.hostUptimeSec > 0) recordUptime(store, "host:hub", CONFIG.name, "Hub-Mac", m.hostUptimeSec, now);
  if (m.disk) recordDisk(store, m.disk.usage, now);

  await save();
}

/* ------------------------------------------------------------ Abfragen */

export function healthFindings(open: ReadonlySet<string>): Finding[] {
  return assessTrends(store, Date.now(), open);
}

export function healthSummary(): TrendSummary {
  return trendSummary(store, Date.now());
}

/** Beim Hub-Start: Verlauf laden, dann alle 5 Minuten Stichproben. */
export async function startHealthTrends(): Promise<void> {
  await loadHealthTrends();
  const every = (Number(process.env.HUB_HEALTH_SAMPLE_INTERVAL) > 0 ? Number(process.env.HUB_HEALTH_SAMPLE_INTERVAL) : 300) * 1000;
  const run = () => void sampleHealth().catch((e) => log(`Frueherkennung: ${e instanceof Error ? e.message : e}`));
  setTimeout(run, 60_000);
  setInterval(run, every);
}
