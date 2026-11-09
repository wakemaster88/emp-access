import { promises as fs } from "node:fs";
import path from "node:path";
import { ConfigSchema, type Config } from "./types";
import { generateInternalToken } from "./internal-token";

/**
 * Lokale Quelle der Wahrheit: `webcams/config.json` (gitignored).
 * LaunchAgent setzt WEBCAMS_CONFIG_PATH, sonst das CWD der Next-App.
 */
const CONFIG_PATH =
  process.env.WEBCAMS_CONFIG_PATH ??
  path.join(/* turbopackIgnore: true */ process.cwd(), "config.json");

const DEFAULT_CONFIG: Config = ConfigSchema.parse({});

let cache: { config: Config; mtimeMs: number } | null = null;

async function readRaw(): Promise<unknown> {
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return null;
    throw err;
  }
}

export async function loadConfig(): Promise<Config> {
  try {
    const stat = await fs.stat(CONFIG_PATH);
    if (cache && cache.mtimeMs === stat.mtimeMs) return cache.config;
    const raw = await readRaw();
    if (!raw) {
      cache = { config: DEFAULT_CONFIG, mtimeMs: 0 };
      return DEFAULT_CONFIG;
    }
    const parsed = ConfigSchema.parse(raw);
    cache = { config: parsed, mtimeMs: stat.mtimeMs };
    return parsed;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      cache = { config: DEFAULT_CONFIG, mtimeMs: 0 };
      return DEFAULT_CONFIG;
    }
    throw err;
  }
}

export async function saveConfig(config: Config): Promise<Config> {
  const validated = ConfigSchema.parse(config);
  // Shared Secret Next ↔ Sidecar: einmalig erzeugen, danach bleibt es stehen.
  if (!validated.internalToken) validated.internalToken = generateInternalToken();
  const tmpPath = `${CONFIG_PATH}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(validated, null, 2), "utf8");
  await fs.rename(tmpPath, CONFIG_PATH);
  const stat = await fs.stat(CONFIG_PATH);
  cache = { config: validated, mtimeMs: stat.mtimeMs };
  return validated;
}

/**
 * Sorgt dafür, dass `internalToken` in der config.json steht (wird beim
 * Server-Start aufgerufen). Bestand-Configs bekommen es so ohne Zutun;
 * der Sidecar liest es von dort. Existiert noch keine config.json, legen
 * wir keine an — das Token entsteht dann beim ersten Speichern.
 */
export async function ensureInternalToken(): Promise<void> {
  const config = await loadConfig();
  if (config.internalToken) return;
  try {
    await fs.access(CONFIG_PATH);
  } catch {
    return;
  }
  await saveConfig(config);
}

export function invalidateCache() {
  cache = null;
}

export function getConfigPath() {
  return CONFIG_PATH;
}
