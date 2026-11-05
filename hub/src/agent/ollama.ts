/**
 * Lokales Sprachmodell ueber Ollama.
 *
 * Beim Start: Ollama suchen, fehlt es, einmal `brew install ollama` und
 * `brew services start ollama` (laeuft dann als eigener LaunchAgent, auch
 * wenn der Hub neu startet). Danach das Modell einmal laden (`/api/pull`).
 * Alles im Hintergrund – der Hub arbeitet waehrenddessen normal weiter.
 *
 * Speicher: Das Modell bleibt nach der letzten Anfrage HUB_AGENT_KEEP_ALIVE
 * im Speicher (Vorgabe 30 min) und wird dann entladen. Auf dem iMac hatte ein
 * vergessener Runner 14 GB festgehalten (hub/IMPROVE.md), das soll hier nicht
 * wieder passieren.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { log } from "../config.js";
import { recordHubEvent } from "../state.js";

const execFileAsync = promisify(execFile);

export const OLLAMA_URL = (process.env.HUB_AGENT_OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
/** MoE mit 3B aktiven Parametern: schnell, gutes Tool-Calling, ~19 GB. */
export const AGENT_MODEL = process.env.HUB_AGENT_MODEL?.trim() || "qwen3:30b";
const KEEP_ALIVE = process.env.HUB_AGENT_KEEP_ALIVE?.trim() || "30m";
const NUM_CTX = Number(process.env.HUB_AGENT_NUM_CTX) > 0 ? Number(process.env.HUB_AGENT_NUM_CTX) : 16384;

const OLLAMA_CANDIDATES = ["/opt/homebrew/bin/ollama", "/usr/local/bin/ollama", "/Applications/Ollama.app/Contents/Resources/ollama"];
const BREW_CANDIDATES = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"];

export interface ChatToolCall {
  function: { name: string; arguments: Record<string, unknown> | string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ChatToolCall[];
  /** Ollama: Name des Werkzeugs bei role "tool". */
  tool_name?: string;
  images?: string[];
}

export interface ToolSpec {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export const LLM = {
  ready: false,
  installing: false,
  model: AGENT_MODEL,
  error: null as string | null,
  lastReplyMs: null as number | null,
  /** Was gerade passiert (Dashboard-Kachel), z. B. „Modell wird geladen“. */
  phase: null as string | null,
  /** Fortschritt des Modell-Downloads in Prozent. */
  pullPct: null as number | null,
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

async function serverUp(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/version`, { signal: AbortSignal.timeout(2_000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function brew(args: string[], timeoutMs: number): Promise<void> {
  const bin = await first(BREW_CANDIDATES);
  if (!bin) throw new Error("Homebrew nicht gefunden – bitte `brew install ollama`");
  await execFileAsync(bin, args, {
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, HOMEBREW_NO_INSTALL_CLEANUP: "1", HOMEBREW_NO_ENV_HINTS: "1" },
  });
}

async function hasModel(): Promise<boolean> {
  const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) return false;
  const body = (await res.json()) as { models?: Array<{ name: string; model?: string }> };
  const want = AGENT_MODEL.includes(":") ? AGENT_MODEL : `${AGENT_MODEL}:latest`;
  return (body.models ?? []).some((m) => m.name === want || m.model === want);
}

async function pullModel(): Promise<void> {
  log(`Assistent: lade Modell ${AGENT_MODEL} (einmalig, mehrere GB) …`);
  LLM.phase = "Modell wird geladen";
  LLM.pullPct = 0;
  const res = await fetch(`${OLLAMA_URL}/api/pull`, {
    method: "POST",
    body: JSON.stringify({ model: AGENT_MODEL, stream: true }),
    signal: AbortSignal.timeout(3 * 60 * 60_000),
  });
  if (!res.ok || !res.body) throw new Error(`Modell laden: HTTP ${res.status}`);
  // NDJSON: {status, digest?, total?, completed?} je Zeile, am Ende {status:"success"}.
  const decoder = new TextDecoder();
  let buf = "";
  let lastStatus = "";
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let ev: { status?: string; total?: number; completed?: number; error?: string };
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }
      if (ev.error) throw new Error(`Modell laden: ${ev.error}`);
      if (ev.status) lastStatus = ev.status;
      if (ev.total && ev.total > 100 * 1024 * 1024 && ev.completed != null) {
        LLM.pullPct = Math.min(100, Math.floor((ev.completed / ev.total) * 100));
      }
    }
  }
  if (lastStatus !== "success") throw new Error(`Modell laden abgebrochen (${lastStatus || "ohne Status"})`);
  LLM.pullPct = null;
  log(`Assistent: Modell ${AGENT_MODEL} geladen`);
}

/** Ollama + Modell bereitstellen. Gibt true zurueck, sobald Anfragen gehen. */
export async function ensureOllama(): Promise<boolean> {
  if (LLM.ready) return true;
  if (LLM.installing) return false;
  LLM.installing = true;
  try {
    if (!(await serverUp())) {
      const setup = process.env.HUB_AGENT_OLLAMA_SETUP !== "0" && process.platform === "darwin";
      if (!setup) throw new Error(`Ollama antwortet nicht unter ${OLLAMA_URL}`);
      if (!(await first(OLLAMA_CANDIDATES))) {
        LLM.phase = "Ollama wird installiert";
        log("Assistent: Ollama fehlt – installiere über Homebrew …");
        await brew(["install", "ollama"], 45 * 60_000);
        recordHubEvent({ kind: "system", severity: "info", where: "Assistent", title: "Ollama installiert" });
      }
      log("Assistent: starte Ollama-Dienst (brew services) …");
      await brew(["services", "start", "ollama"], 60_000);
      for (let i = 0; i < 30 && !(await serverUp()); i++) await new Promise((r) => setTimeout(r, 1_000));
      if (!(await serverUp())) throw new Error("Ollama-Dienst startet nicht");
    }
    if (!(await hasModel())) await pullModel();
    LLM.ready = true;
    LLM.error = null;
    recordHubEvent({ kind: "system", severity: "info", where: "Assistent", title: `Sprachmodell bereit (${AGENT_MODEL})` });
    return true;
  } catch (e) {
    LLM.error = e instanceof Error ? e.message.split("\n")[0] : String(e);
    log(`Assistent: ${LLM.error}`);
    recordHubEvent({ kind: "system", severity: "warn", where: "Assistent", title: "Sprachmodell nicht bereit", detail: LLM.error });
    return false;
  } finally {
    LLM.installing = false;
    LLM.phase = null;
  }
}

/** Eine Runde mit dem Modell. Gibt die Antwort des Assistenten zurueck. */
export async function chat(messages: ChatMessage[], tools: ToolSpec[]): Promise<ChatMessage> {
  const started = Date.now();
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    body: JSON.stringify({
      model: AGENT_MODEL,
      messages,
      tools: tools.length ? tools : undefined,
      stream: false,
      // Kein langes Nachdenken fuer Chat-Antworten; der Bericht darf mehr.
      think: false,
      keep_alive: KEEP_ALIVE,
      options: { num_ctx: NUM_CTX, temperature: 0.3 },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const body = (await res.json().catch(() => ({}))) as { message?: ChatMessage; error?: string };
  if (!res.ok || !body.message) {
    // Modell weg (z. B. geloescht) → beim naechsten Mal neu bereitstellen.
    if (res.status === 404) LLM.ready = false;
    throw new Error(body.error ?? `Ollama HTTP ${res.status}`);
  }
  LLM.lastReplyMs = Date.now() - started;
  return body.message;
}

/* ------------------------------------------------------------ Anzeige */

/** Ob das Modell gerade im RAM liegt (Ollama `/api/ps`), fuer Systeme im Dashboard. */
export const LLM_LOADED = { loaded: false, sizeBytes: 0, checkedAt: 0 };
let psRunning = false;

/** Hoechstens alle 30 s eine Abfrage anstossen; blockiert das Dashboard nie. */
export function refreshLoadedModel(): void {
  if (psRunning || !LLM.ready || Date.now() - LLM_LOADED.checkedAt < 30_000) return;
  psRunning = true;
  LLM_LOADED.checkedAt = Date.now();
  fetch(`${OLLAMA_URL}/api/ps`, { signal: AbortSignal.timeout(2_000) })
    .then((res) => (res.ok ? res.json() : { models: [] }))
    .then((body: { models?: Array<{ name: string; model?: string; size?: number }> }) => {
      const want = AGENT_MODEL.includes(":") ? AGENT_MODEL : `${AGENT_MODEL}:latest`;
      const m = (body.models ?? []).find((x) => x.name === want || x.model === want);
      LLM_LOADED.loaded = Boolean(m);
      LLM_LOADED.sizeBytes = m?.size ?? 0;
    })
    .catch(() => {
      LLM_LOADED.loaded = false;
    })
    .finally(() => {
      psRunning = false;
    });
}
