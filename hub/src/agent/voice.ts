/**
 * Sprachnachrichten aus Telegram lokal in Text umwandeln (whisper.cpp).
 *
 * Beim Start des Assistenten: `whisper-cli` suchen, fehlt es, einmal
 * `brew install whisper-cpp`; dann das Modell (Vorgabe large-v3-turbo,
 * ~1,6 GB, gutes Deutsch, auf Apple Silicon per Metal schnell) nach
 * hub/.cache/whisper laden. Telegram schickt OGG/Opus – ffmpeg macht daraus
 * 16-kHz-Mono-WAV. Alles lokal, keine Audiodaten verlassen den Hub.
 */
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { CONFIG, log } from "../config.js";

const execFileAsync = promisify(execFile);

const MODEL = process.env.HUB_AGENT_WHISPER_MODEL?.trim() || "large-v3-turbo";
const MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${MODEL}.bin`;
const WHISPER_CANDIDATES = ["/opt/homebrew/bin/whisper-cli", "/usr/local/bin/whisper-cli", "/opt/homebrew/bin/whisper-cpp"];
const FFMPEG_CANDIDATES = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"];
const BREW_CANDIDATES = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"];

export const VOICE = {
  ready: false,
  installing: false,
  error: null as string | null,
  model: MODEL,
};

async function first(paths: string[]): Promise<string | null> {
  for (const p of paths) {
    try {
      await fs.access(p, fs.constants.X_OK);
      return p;
    } catch {
      /* weiter */
    }
  }
  return null;
}

function modelPath(): string {
  return path.join(CONFIG.hubDir, ".cache", "whisper", `ggml-${MODEL}.bin`);
}

async function downloadModel(): Promise<void> {
  const file = modelPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  log(`Assistent: lade Sprach-Modell whisper ${MODEL} (einmalig, ~1,6 GB) …`);
  const res = await fetch(MODEL_URL, { signal: AbortSignal.timeout(2 * 60 * 60_000) });
  if (!res.ok || !res.body) throw new Error(`Whisper-Modell: HTTP ${res.status}`);
  const part = `${file}.part`;
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(part));
  const size = (await fs.stat(part)).size;
  if (size < 50 * 1024 * 1024) throw new Error(`Whisper-Modell unvollständig (${size} Bytes)`);
  await fs.rename(part, file);
  log("Assistent: Sprach-Modell geladen");
}

/** whisper.cpp + Modell bereitstellen. */
export async function ensureWhisper(): Promise<boolean> {
  if (VOICE.ready) return true;
  if (VOICE.installing || process.env.HUB_AGENT_VOICE === "0") return false;
  VOICE.installing = true;
  try {
    if (!(await first(WHISPER_CANDIDATES))) {
      const brew = await first(BREW_CANDIDATES);
      if (!brew || process.platform !== "darwin") throw new Error("whisper-cli fehlt – bitte `brew install whisper-cpp`");
      log("Assistent: whisper-cpp fehlt – installiere über Homebrew …");
      await execFileAsync(brew, ["install", "whisper-cpp"], {
        timeout: 45 * 60_000,
        maxBuffer: 32 * 1024 * 1024,
        env: { ...process.env, HOMEBREW_NO_INSTALL_CLEANUP: "1", HOMEBREW_NO_ENV_HINTS: "1" },
      });
    }
    if (!(await first(FFMPEG_CANDIDATES))) throw new Error("ffmpeg fehlt (wird vom Hub für go2rtc eingerichtet)");
    try {
      await fs.access(modelPath());
    } catch {
      await downloadModel();
    }
    VOICE.ready = true;
    VOICE.error = null;
    return true;
  } catch (e) {
    VOICE.error = e instanceof Error ? e.message.split("\n")[0] : String(e);
    log(`Assistent: Sprache: ${VOICE.error}`);
    return false;
  } finally {
    VOICE.installing = false;
  }
}

/** Telegram-Sprachnachricht (OGG/Opus) → Text. */
export async function transcribe(audio: Buffer): Promise<string> {
  if (!(await ensureWhisper())) throw new Error(VOICE.error ?? "Spracherkennung wird noch eingerichtet");
  const whisper = (await first(WHISPER_CANDIDATES)) as string;
  const ffmpeg = (await first(FFMPEG_CANDIDATES)) as string;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "emp-voice-"));
  try {
    const input = path.join(dir, "in.ogg");
    const wav = path.join(dir, "in.wav");
    await fs.writeFile(input, audio);
    await execFileAsync(ffmpeg, ["-y", "-loglevel", "error", "-i", input, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav], {
      timeout: 60_000,
    });
    const { stdout } = await execFileAsync(
      whisper,
      ["-m", modelPath(), "-f", wav, "-l", process.env.HUB_AGENT_VOICE_LANG || "de", "-nt", "-np", "-t", String(Math.min(8, os.cpus().length))],
      { timeout: 180_000, maxBuffer: 4 * 1024 * 1024 }
    );
    return stdout.replace(/\s+/g, " ").trim();
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
