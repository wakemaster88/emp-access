/**
 * go2rtc.yaml auf dem Hub-Rechner: ffmpeg-Pfad und RTSP-Server.
 *
 * ffmpeg: Ohne ffmpeg liefert go2rtc fuer `/api/frame.jpeg` HTTP 500, die
 * Vorschaubilder der Kamera-Zentrale bleiben leer. Beim Start ffmpeg suchen
 * (Homebrew Apple Silicon/Intel), fehlt es, einmal `brew install ffmpeg` im
 * Hintergrund. Der absolute Pfad kommt als `ffmpeg: bin:` in die yaml, weil
 * der go2rtc-LaunchAgent ohne Homebrew im PATH laeuft.
 *
 * RTSP: Der RTSP-Server von go2rtc lauscht nur auf 127.0.0.1:8554; einziger
 * Abnehmer ist der Tracker auf diesem Rechner. Die Kiosk-App schreibt den
 * Block selbst und uebernimmt beim Neuschreiben einen vorhandenen
 * ffmpeg-Block; ein aelterer Kiosk-Stand tut beides nicht. Darum ergaenzt
 * der Hub fehlende Bloecke beim Start und wieder, sobald sich die Datei
 * aendert (Blick alle 2 min aus dem go2rtc-Waechter). Ein vorhandener Block
 * bleibt, wie er ist.
 *
 * Beides in einem Zug: eine Schreibung, ein Neustart von go2rtc und nur,
 * wenn sich der Inhalt wirklich aendert. Nur auf macOS; abschalten mit
 * `HUB_FFMPEG_SETUP=0` (nur ffmpeg) oder `HUB_GO2RTC_YAML=0` (die yaml).
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { CONFIG, log } from "./config.js";
import { recordHubEvent } from "./state.js";
import { improve } from "./improve-log.js";
import { exposureLine, go2rtcExposure, go2rtcSetupSwitches, planGo2rtcYaml } from "./ffmpeg-yaml.js";

const execFileAsync = promisify(execFile);
const GO2RTC_URL = (process.env.HUB_GO2RTC_URL || "http://127.0.0.1:1984").replace(/\/$/, "");
const FFMPEG_CANDIDATES = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"];
const BREW_CANDIDATES = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"];

/** Bekannter ffmpeg-Pfad fuer die yaml; null = (noch) keiner. */
let ffmpegBin: string | null = null;
/** Aenderungszeit der yaml beim letzten Abgleich; 0 = noch nie gelesen. */
let seenMtimeMs = 0;
/** Aenderungszeit, zu der zuletzt ein Lese- oder Schreibfehler gemeldet wurde. */
let failedMtimeMs = 0;
/** yaml abgleichen? Erst `ensureFfmpeg` schaltet es ein (macOS, ohne HUB_GO2RTC_YAML=0). */
let yamlEnabled = false;
let lastLine: string | null = null;
/** Laufender Abgleich: Start und Waechter nie gleichzeitig. */
let running: Promise<void> | null = null;

function go2rtcYamlPath(): string {
  return path.join(CONFIG.repoDir, "webcams", "infra", "go2rtc.yaml");
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function first(paths: string[]): Promise<string | null> {
  for (const p of paths) if (await exists(p)) return p;
  return null;
}

async function installFfmpeg(): Promise<string | null> {
  const brew = await first(BREW_CANDIDATES);
  if (!brew) {
    log("ffmpeg fehlt und Homebrew nicht gefunden – Kamera-Standbilder bleiben aus. Bitte `brew install ffmpeg`.");
    return null;
  }
  log("ffmpeg fehlt – installiere über Homebrew (läuft im Hintergrund, kann einige Minuten dauern) …");
  try {
    await execFileAsync(brew, ["install", "ffmpeg"], {
      timeout: 45 * 60_000,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, HOMEBREW_NO_INSTALL_CLEANUP: "1", HOMEBREW_NO_ENV_HINTS: "1" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
    log(`brew install ffmpeg fehlgeschlagen: ${msg}`);
    recordHubEvent({ kind: "system", severity: "warn", where: "ffmpeg", title: "ffmpeg-Installation fehlgeschlagen", detail: msg });
    return null;
  }
  const bin = await first(FFMPEG_CANDIDATES);
  if (bin) {
    log(`ffmpeg installiert: ${bin}`);
    recordHubEvent({ kind: "system", severity: "info", where: "ffmpeg", title: "ffmpeg installiert", detail: bin });
  }
  return bin;
}

/**
 * Datei ersetzen, ohne die Rechte zu aendern; eigene Zwischendatei (die
 * Kiosk-App nutzt `.tmp`). Scheitert ein Schritt, kommt die Zwischendatei weg.
 */
async function replaceFile(file: string, data: string, mode: number): Promise<void> {
  const tmp = `${file}.hub-tmp`;
  try {
    await fs.writeFile(tmp, data, { encoding: "utf8", mode: mode & 0o777 });
    await fs.chmod(tmp, mode & 0o777);
    await fs.rename(tmp, file);
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message.split("\n")[0] : String(e);
}

/** Fehler je Aenderungszeit der Datei nur einmal melden; der naechste Versuch kommt mit der naechsten Aenderung. */
function failedOnce(mtimeMs: number): boolean {
  const fresh = failedMtimeMs !== mtimeMs;
  failedMtimeMs = mtimeMs;
  seenMtimeMs = mtimeMs;
  return fresh;
}

async function applyNow(): Promise<void> {
  const file = go2rtcYamlPath();
  let st: Awaited<ReturnType<typeof fs.stat>>;
  try {
    st = await fs.stat(file);
  } catch {
    return; // keine go2rtc-Konfiguration auf diesem Rechner
  }
  let yaml: string;
  try {
    yaml = await fs.readFile(file, "utf8");
  } catch (e) {
    if (failedOnce(Number(st.mtimeMs))) log(`go2rtc.yaml nicht lesbar: ${errText(e)}`);
    return;
  }
  const plan = planGo2rtcYaml(yaml, ffmpegBin);
  let written = false;
  let note = "";
  if (plan.added.length) {
    try {
      await replaceFile(file, plan.yaml, Number(st.mode));
      written = true;
      note = ` (go2rtc.yaml ergänzt: ${plan.added.join(", ")}; go2rtc wird neu gestartet)`;
    } catch (e) {
      if (failedOnce(Number(st.mtimeMs))) {
        note = ` (go2rtc.yaml nicht ergänzt: ${errText(e)}; neuer Versuch, sobald sich die Datei ändert)`;
      }
    }
    if (written) {
      try {
        await fetch(`${GO2RTC_URL}/api/restart`, { method: "POST", signal: AbortSignal.timeout(5000) });
      } catch {
        /* go2rtc laeuft evtl. nicht; beim naechsten Start gilt die yaml */
      }
    }
  }
  try {
    seenMtimeMs = (await fs.stat(file)).mtimeMs;
  } catch {
    seenMtimeMs = Number(st.mtimeMs);
  }
  const exp = go2rtcExposure(written ? plan.yaml : yaml);
  const line = exposureLine(exp);
  if (line !== lastLine || note) log(`${line}${note}`);
  lastLine = line;
  if (!exp.apiLocal || !exp.rtspLocal) improve("camera", "go2rtc_exposed", { api: exp.api, rtsp: exp.rtsp });
}

/** go2rtc.yaml abgleichen (nie zwei Durchlaeufe gleichzeitig). Wirft nie. */
async function applyGo2rtcYaml(): Promise<void> {
  while (running) await running;
  running = applyNow()
    .catch((e) => log(`go2rtc.yaml: ${e instanceof Error ? e.message : String(e)}`))
    .finally(() => {
      running = null;
    });
  return running;
}

/**
 * Aus dem go2rtc-Waechter (alle 2 min): Hat jemand die yaml neu geschrieben
 * (etwa der Kiosk mit einem aelteren Stand), wird sie erneut abgeglichen.
 */
export async function recheckGo2rtcYaml(): Promise<void> {
  if (!yamlEnabled || running) return;
  let mtime: number;
  try {
    mtime = (await fs.stat(go2rtcYamlPath())).mtimeMs;
  } catch {
    return;
  }
  if (mtime === seenMtimeMs) return;
  await applyGo2rtcYaml();
}

/**
 * Beim Hub-Start (nur macOS): ffmpeg suchen, dann die yaml in einem Zug
 * abgleichen. Auf anderen Systemen geschieht nichts.
 */
export async function ensureFfmpeg(): Promise<void> {
  const on = go2rtcSetupSwitches(process.platform, process.env);
  yamlEnabled = on.yaml;
  if (!on.ffmpeg && !on.yaml) return;
  try {
    if (on.ffmpeg) ffmpegBin = await first(FFMPEG_CANDIDATES);
    if (on.yaml) await applyGo2rtcYaml();
    if (on.ffmpeg && !ffmpegBin) {
      // Die Installation kann dauern; RTSP ist schon abgeglichen, ffmpeg kommt danach dazu.
      ffmpegBin = await installFfmpeg();
      if (ffmpegBin && on.yaml) await applyGo2rtcYaml();
    }
  } catch (e) {
    log(`ffmpeg-Setup: ${e instanceof Error ? e.message : String(e)}`);
  }
}
