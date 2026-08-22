import { promises as fs } from "node:fs";
import path from "node:path";
import { ConfigSchema, type Config } from "./types";

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
  const tmpPath = `${CONFIG_PATH}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(validated, null, 2), "utf8");
  await fs.rename(tmpPath, CONFIG_PATH);
  const stat = await fs.stat(CONFIG_PATH);
  cache = { config: validated, mtimeMs: stat.mtimeMs };
  return validated;
}

export function invalidateCache() {
  cache = null;
}

export function getConfigPath() {
  return CONFIG_PATH;
}
