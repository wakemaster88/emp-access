/**
 * ffmpeg fuer go2rtc. Ohne ffmpeg liefert go2rtc fuer `/api/frame.jpeg`
 * HTTP 500, die Vorschaubilder der Kamera-Zentrale bleiben leer.
 *
 * Beim Start: ffmpeg suchen (Homebrew Apple Silicon/Intel), fehlt es, einmal
 * `brew install ffmpeg` im Hintergrund. Danach den absoluten Pfad als
 * `ffmpeg: bin:` in die go2rtc.yaml schreiben, weil der go2rtc-LaunchAgent
 * ohne Homebrew im PATH laeuft, und go2rtc neu starten.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { CONFIG, log } from "./config.js";
import { recordHubEvent } from "./state.js";
import { hasFfmpegBlock, withFfmpegBin } from "./ffmpeg-yaml.js";

const execFileAsync = promisify(execFile);
const GO2RTC_URL = (process.env.HUB_GO2RTC_URL || "http://127.0.0.1:1984").replace(/\/$/, "");
const FFMPEG_CANDIDATES = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"];
const BREW_CANDIDATES = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"];

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

async function pinInGo2rtc(bin: string): Promise<void> {
  const file = path.join(CONFIG.repoDir, "webcams", "infra", "go2rtc.yaml");
  let yaml: string;
  try {
    yaml = await fs.readFile(file, "utf8");
  } catch {
    return; // keine go2rtc-Konfiguration auf diesem Rechner
  }
  if (hasFfmpegBlock(yaml)) return;
  await fs.writeFile(file, withFfmpegBin(yaml, bin), "utf8");
  log(`go2rtc.yaml: ffmpeg.bin = ${bin}, go2rtc wird neu gestartet`);
  try {
    await fetch(`${GO2RTC_URL}/api/restart`, { method: "POST", signal: AbortSignal.timeout(5000) });
  } catch {
    /* go2rtc laeuft evtl. nicht; beim naechsten Start gilt die yaml */
  }
}

export async function ensureFfmpeg(): Promise<void> {
  if (process.platform !== "darwin" || process.env.HUB_FFMPEG_SETUP === "0") return;
  try {
    const bin = (await first(FFMPEG_CANDIDATES)) ?? (await installFfmpeg());
    if (bin) await pinInGo2rtc(bin);
  } catch (e) {
    log(`ffmpeg-Setup: ${e instanceof Error ? e.message : String(e)}`);
  }
}
