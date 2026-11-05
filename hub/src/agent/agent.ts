/**
 * Hub-Assistent: lokales Sprachmodell (Ollama) + eigener Telegram-Bot.
 *
 * - Gespraech: Aaron schreibt dem Bot, das Modell beantwortet mit den
 *   Werkzeugen aus tools.ts. Lesen laeuft sofort; alles, was schaltet,
 *   kommt als Rueckfrage mit Knopf „Ausführen“ / „Abbrechen“.
 * - Waechter: alle 5 Minuten Befunde sammeln (watch.ts), neue und erledigte
 *   melden (findings.ts). Warnungen in der Ruhezeit gesammelt am Morgen.
 * - Tagesbericht: einmal am Tag Lage, Auffaelligkeiten, Vorschlaege zur
 *   Optimierung – Vorschlaege, keine eigenmaechtigen Aenderungen.
 *
 * Aktiv, sobald HUB_AGENT_TELEGRAM_TOKEN in hub/.env steht.
 */
import { randomInt, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CONFIG, api, log } from "../config.js";
import { recordHubEvent } from "../state.js";
import { LLM, LLM_LOADED, VISION, askVision, chat, ensureOllama, refreshLoadedModel, type ChatMessage } from "./ollama.js";
import { SENTINEL, startSentinel } from "./sentinel.js";
import { answerVehicle } from "./vehicles.js";
import { answerPersonOk } from "./people.js";
import { stripThinking } from "./think.js";
import {
  answerCallback,
  downloadFile,
  downloadPhoto,
  editText,
  pollUpdates,
  sendPhoto,
  sendText,
  setCommands,
  telegramConfigured,
  typing,
  type TgButton,
  type TgUpdate,
} from "./telegram.js";
import { TOOLS, findTool, readNotes, toolResultText, toolSpecs, type ToolContext } from "./tools.js";
import { diffFindings, newWatchState, openFindings, type Finding } from "./findings.js";
import { berlinHHMM, berlinHour, collectFindings, inQuietHours } from "./watch.js";
import { VOICE, ensureWhisper, transcribe } from "./voice.js";
import { dayPreviewText } from "../day-preview.js";
import { handleUnknownChat, isPaired, newPairingState, type PairingState } from "./pairing.js";

const ENV_CHAT_IDS = (process.env.HUB_AGENT_TELEGRAM_CHAT_IDS || "")
  .split(/[,\s]+/)
  .map((s) => s.trim())
  .filter(Boolean);
const WATCH_MS = (Number(process.env.HUB_AGENT_WATCH_INTERVAL) > 0 ? Number(process.env.HUB_AGENT_WATCH_INTERVAL) : 300) * 1000;
const REPORT_TIME = (process.env.HUB_AGENT_REPORT_TIME || "07:30").trim();
const QUIET = (process.env.HUB_AGENT_QUIET ?? "22-7").trim();
const MAX_HISTORY = 24;
const MAX_ROUNDS = 8;
const PENDING_TTL_MS = 10 * 60_000;

export const AGENT = {
  enabled: false,
  pairedChats: 0,
  lastMessageAt: null as string | null,
  lastReportAt: null as string | null,
  lastWatchAt: null as string | null,
};

/* ------------------------------------------------------------ Speicher */

const pairing: PairingState = newPairingState();
const histories = new Map<string, ChatMessage[]>();
const queues = new Map<string, Promise<void>>();

interface Pending {
  chatId: string;
  tool: string;
  args: Record<string, unknown>;
  desc: string;
  createdAt: number;
}
const pending = new Map<string, Pending>();

function storePath(): string {
  return path.join(CONFIG.hubDir, ".cache", "agent.json");
}

async function loadStore(): Promise<void> {
  try {
    const raw = JSON.parse(await readFile(storePath(), "utf8")) as { chats?: PairingState["chats"]; lastReportDay?: string };
    pairing.chats = Array.isArray(raw.chats) ? raw.chats : [];
    lastReportDay = raw.lastReportDay ?? null;
  } catch {
    /* noch nichts gespeichert */
  }
  AGENT.pairedChats = pairing.chats.length + ENV_CHAT_IDS.length;
}

async function saveStore(): Promise<void> {
  await mkdir(path.dirname(storePath()), { recursive: true });
  await writeFile(storePath(), JSON.stringify({ chats: pairing.chats, lastReportDay }, null, 2), "utf8");
  AGENT.pairedChats = pairing.chats.length + ENV_CHAT_IDS.length;
}

function chatIds(): string[] {
  return [...new Set([...ENV_CHAT_IDS, ...pairing.chats.map((c) => c.id)])];
}

/* ------------------------------------------------------------ Prompt */

async function systemPrompt(): Promise<string> {
  const now = new Date();
  // weekday zusammen mit dateStyle/timeStyle wirft in Node („Invalid option“).
  const when = now.toLocaleString("de-DE", {
    timeZone: "Europe/Berlin",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const notes = await readNotes();
  const open = openFindings(watch);
  return [
    `Du bist der Hub-Assistent der Wasserski- und Freizeitanlage Tuttenbrocksee. Du läufst lokal auf dem Hub (Mac Studio „${CONFIG.name}“ im Technikraum) und sprichst per Telegram mit Aaron, dem Betreiber.`,
    `Jetzt: ${when} (Europe/Berlin).`,
    "",
    "Deine Aufgaben: die Anlage überwachen, Fragen zur Lage beantworten, auf Wunsch Geräte steuern und Verbesserungen vorschlagen.",
    "",
    "Regeln:",
    "- Antworte auf Deutsch, kurz und konkret, ohne Markdown-Tabellen. Telegram zeigt reinen Text.",
    "- Fakten holst du dir mit den Werkzeugen. Erfinde keine Zustände, Namen oder Zahlen. Wenn ein Werkzeug scheitert, sag das.",
    "- Werkzeuge, die etwas schalten, legen eine Rückfrage an. Aaron bestätigt per Knopf. Sag dann nur, dass die Rückfrage da ist, und ruf das Werkzeug nicht noch einmal auf.",
    "- Schalte nur, worum Aaron gebeten hat. Keine eigenmächtigen Aktionen.",
    "- Netzwerk (Router PR60X, Switches, VLANs, DHCP, WLAN, Firewall) änderst du nie. Du kannst Befunde lesen und Änderungen vorschlagen; umsetzen tut Aaron.",
    "- Kameras in Umkleiden/WC gibt es nicht und darf es nicht geben.",
    "- Mit look_at_camera siehst du dir ein aktuelles Kamerabild selbst an. Außerhalb des Betriebs bewertet der Wächter Personen- und Fahrzeugereignisse automatisch und meldet Auffälliges mit Bild.",
    "",
    "Anlage in Kürze: VLAN 1 Management, 20 Kasse, 30 Kameras (ohne Internet), 40 Betrieb (Shelly), 41 Anlage-Audio, 70 Verwaltung, 80 Personal. Kameras Reolink, Tor mit DoorBird, Audio Soundweb London, Mäher Mammotion Luba. Räume, Geräte und Regeln pflegt die Cloud (EMP-Access), der Hub spiegelt und schaltet im LAN.",
    open.length ? `\nOffene Befunde des Wächters: ${open.map((f) => f.title).join("; ")}` : "",
    notes ? `\nGemerkt (remember):\n${notes}` : "",
    // Hybrides Qwen3 ohne Instruct: Denkmodus per Schalter aus (sonst Denktext in der Antwort).
    /qwen3/i.test(LLM.model) && !/instruct/i.test(LLM.model) ? "/no_think" : "",
  ].join("\n");
}

/* ------------------------------------------------------------ Gespraech */

function trimHistory(h: ChatMessage[]): ChatMessage[] {
  if (h.length <= MAX_HISTORY) return h;
  let cut = h.length - MAX_HISTORY;
  // An einer Nutzer-Nachricht beginnen, damit keine Tool-Antwort ohne Aufruf bleibt.
  while (cut < h.length && h[cut].role !== "user") cut++;
  return h.slice(cut);
}

function parseArgs(raw: Record<string, unknown> | string | undefined): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      const v = JSON.parse(raw);
      return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return raw;
}

function ctxFor(chatId: string): ToolContext {
  return { sendPhoto: (jpeg, caption) => sendPhoto(chatId, jpeg, caption) };
}

/**
 * Eine Runde Gespraech. `allowAct` = Schaltwerkzeuge anbieten (Tagesbericht: nein).
 * Gibt den Antworttext zurueck.
 */
async function converse(chatId: string, history: ChatMessage[], allowAct = true): Promise<string> {
  // Ohne Chat (Tagesbericht): nur lesen, keine Bilder verschicken.
  const tools = toolSpecs().filter(
    (t) => allowAct || (findTool(t.function.name)?.risk === "read" && !["camera_snapshot", "look_at_camera"].includes(t.function.name))
  );
  const sys: ChatMessage = { role: "system", content: await systemPrompt() };
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const reply = await chat([sys, ...history], tools);
    history.push({ role: "assistant", content: reply.content ?? "", tool_calls: reply.tool_calls });
    const calls = reply.tool_calls ?? [];
    if (calls.length === 0) return stripThinking(reply.content ?? "");
    for (const call of calls) {
      const name = call.function?.name ?? "";
      const args = parseArgs(call.function?.arguments);
      const tool = findTool(name);
      let content: string;
      if (!tool || !tools.some((t) => t.function.name === name)) {
        content = `Fehler: Werkzeug ${name} gibt es nicht.`;
      } else if (tool.risk === "act") {
        const desc = tool.describe ? tool.describe(args) : `${name} ${JSON.stringify(args)}`;
        const id = randomBytes(6).toString("hex");
        pending.set(id, { chatId, tool: name, args, desc, createdAt: Date.now() });
        await sendText(chatId, `Soll ich das ausführen?\n• ${desc}`, [
          [
            { text: "Ausführen", callback_data: `ok:${id}` },
            { text: "Abbrechen", callback_data: `no:${id}` },
          ],
        ]);
        content = "Rückfrage an Aaron gesendet, wartet auf seine Bestätigung per Knopf. Nicht erneut aufrufen.";
      } else {
        try {
          content = toolResultText(await tool.run(args, ctxFor(chatId)));
        } catch (e) {
          content = `Fehler: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
      history.push({ role: "tool", tool_name: name, content });
    }
  }
  return "Das wurde mir zu verschachtelt – frag bitte etwas konkreter.";
}

/** Notfall-Antwort ohne Modell (Modell laedt noch oder Ollama ist weg). */
async function plainStatus(): Promise<string> {
  const status = (await findTool("hub_status")!.run({}, { sendPhoto: async () => undefined })) as {
    cloud: { lastSuccessAt: string | null };
    system: { cpuPct: number | null; ramPct: number | null; diskPct: number | null };
    cameras: { total: number; reachable: number; unreachable: string[] };
  };
  const lines = [
    `Hub ${CONFIG.name}, Cloud zuletzt ${status.cloud.lastSuccessAt ? berlinHHMM(new Date(status.cloud.lastSuccessAt)) : "nie"}`,
    `CPU ${status.system.cpuPct ?? "?"} %, RAM ${status.system.ramPct ?? "?"} %, Platte ${status.system.diskPct ?? "?"} %`,
    `Kameras ${status.cameras.reachable}/${status.cameras.total} erreichbar`,
    ...status.cameras.unreachable.slice(0, 10).map((c) => `• ${c}`),
  ];
  const open = openFindings(watch);
  if (open.length) lines.push("", "Offene Befunde:", ...open.map((f) => `• ${f.title}`));
  return lines.join("\n");
}

async function llmOrExplain(chatId: string): Promise<boolean> {
  if (LLM.ready) return true;
  void ensureOllama();
  const why = LLM.installing ? "wird gerade eingerichtet (der erste Download dauert eine Weile)" : `ist nicht bereit${LLM.error ? `: ${LLM.error}` : ""}`;
  await sendText(chatId, `Das Sprachmodell ${why}. Bis dahin kann ich nur /status und /befunde.\n\n${await plainStatus()}`);
  return false;
}

async function handleMessage(chatId: string, text: string): Promise<void> {
  AGENT.lastMessageAt = new Date().toISOString();
  const cmd = text.trim().split(/\s+/)[0].toLowerCase().replace(/@.*$/, "");
  if (cmd === "/start" || cmd === "/neu") {
    histories.delete(chatId);
    await sendText(chatId, "Neues Gespräch. Frag mich nach der Lage, nach Kameras, Räumen oder Geräten, oder sag mir, was ich schalten soll.");
    return;
  }
  if (cmd === "/befunde") {
    const open = openFindings(watch);
    await sendText(chatId, open.length ? open.map((f) => `• ${f.title}${f.detail ? ` (${f.detail})` : ""}`).join("\n") : "Keine offenen Befunde.");
    return;
  }
  if (cmd === "/status" && !LLM.ready) {
    await sendText(chatId, await plainStatus());
    return;
  }
  if (cmd === "/heute" || cmd === "/morgen") {
    await sendText(chatId, await dayPreviewText(cmd === "/morgen" ? 1 : 0));
    return;
  }
  if (cmd === "/bericht") {
    if (await llmOrExplain(chatId)) await sendText(chatId, await dailyReport());
    return;
  }
  if (!(await llmOrExplain(chatId))) return;
  const prompt = cmd === "/status" ? "Wie ist die Lage? Kurz, mit allem, was auffällt." : text;
  const history = histories.get(chatId) ?? [];
  history.push({ role: "user", content: prompt });
  await typing(chatId);
  const keepTyping = setInterval(() => void typing(chatId), 4_500);
  try {
    const answer = await converse(chatId, history);
    histories.set(chatId, trimHistory(history));
    if (answer) await sendText(chatId, answer);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`Assistent: Antwort fehlgeschlagen: ${msg}`);
    histories.set(chatId, trimHistory(history.filter((m) => m.role === "user" || m.role === "assistant")));
    await sendText(chatId, `Da ist etwas schiefgegangen: ${msg}`);
  } finally {
    clearInterval(keepTyping);
  }
}

async function handleCallback(cb: NonNullable<TgUpdate["callback_query"]>): Promise<void> {
  const chatId = String(cb.message?.chat.id ?? "");
  const veh = (cb.data ?? "").match(/^v(ok|no):([A-Z0-9ÄÖÜ]{4,12})$/);
  const pok = (cb.data ?? "").match(/^pok:([0-9a-f]{8})$/);
  const m = (cb.data ?? "").match(/^(ok|no):([0-9a-f]{12})$/);
  if (!chatId || !isPaired(pairing, chatId, ENV_CHAT_IDS) || (!m && !veh && !pok)) {
    await answerCallback(cb.id, "Nicht berechtigt.");
    return;
  }
  const msgId = cb.message?.message_id;
  if (pok) {
    await answerCallback(cb.id, "Gemerkt");
    const line = await answerPersonOk(pok[1]).catch((e) => `Fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
    if (msgId) await sendText(chatId, line).catch(() => undefined);
    return;
  }
  if (veh) {
    await answerCallback(cb.id, veh[1] === "ok" ? "Wird genehmigt …" : "Ok");
    const line = await answerVehicle(veh[1] === "ok", veh[2]).catch((e) => `Fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`);
    if (msgId) await editText(chatId, msgId, line);
    const h = histories.get(chatId) ?? [];
    h.push({ role: "assistant", content: `(${line})` });
    histories.set(chatId, trimHistory(h));
    return;
  }
  if (!m) return;
  const p = pending.get(m[2]);
  if (!p || (p.chatId !== "*" && p.chatId !== chatId) || Date.now() - p.createdAt > PENDING_TTL_MS) {
    pending.delete(m[2]);
    await answerCallback(cb.id, "Abgelaufen – bitte neu fragen.");
    if (msgId) await editText(chatId, msgId, `${cb.message?.text ?? ""}\n\nAbgelaufen.`);
    return;
  }
  pending.delete(m[2]);
  const history = histories.get(chatId) ?? [];
  if (m[1] === "no") {
    await answerCallback(cb.id, "Abgebrochen");
    if (msgId) await editText(chatId, msgId, `Abgebrochen: ${p.desc}`);
    history.push({ role: "assistant", content: `(Aaron hat abgebrochen: ${p.desc})` });
    histories.set(chatId, trimHistory(history));
    return;
  }
  await answerCallback(cb.id, "Wird ausgeführt …");
  let line: string;
  try {
    const r = (await findTool(p.tool)!.run(p.args, ctxFor(chatId))) as { success?: boolean; ok?: boolean; error?: string } | undefined;
    const failed = r && (r.success === false || r.ok === false);
    line = failed ? `Fehlgeschlagen: ${p.desc} – ${r?.error ?? "unbekannter Fehler"}` : `Erledigt: ${p.desc}`;
  } catch (e) {
    line = `Fehlgeschlagen: ${p.desc} – ${e instanceof Error ? e.message : String(e)}`;
  }
  log(`Assistent: ${line}`);
  recordHubEvent({ kind: "task", severity: line.startsWith("Erledigt") ? "info" : "warn", where: "Assistent", title: line });
  if (msgId) await editText(chatId, msgId, line);
  history.push({ role: "assistant", content: `(${line})` });
  histories.set(chatId, trimHistory(history));
}

/** Knopf fuer eine vorbereitete Aktion (Waechter-Meldung): der Tipp ist die Bestaetigung. */
function offer(label: string, tool: string, args: Record<string, unknown>, desc: string): TgButton {
  const id = randomBytes(6).toString("hex");
  pending.set(id, { chatId: "*", tool, args, desc, createdAt: Date.now() });
  return { text: label, callback_data: `ok:${id}` };
}

/* ------------------------------------------------------------ Kopplung */

async function reportPairingCode(code: string | null): Promise<void> {
  const alerts = code
    ? [
        {
          key: "agent-pairing",
          title: `Hub-Assistent: Kopplungscode ${code}`,
          detail: "Diesen Code im neuen Telegram-Bot des Hubs eingeben (15 Minuten gültig). Warst du das nicht, einfach ignorieren.",
          severity: "warn",
        },
      ]
    : [];
  await api("/api/hub/alerts", {
    method: "POST",
    body: JSON.stringify({ hubName: CONFIG.name, source: "agent", alerts }),
  }).catch((e) => log(`Assistent: Kopplungscode nicht gemeldet: ${e instanceof Error ? e.message : e}`));
}

async function handleUnknown(chatId: string, chatType: string, name: string, text: string): Promise<void> {
  if (chatType !== "private") return;
  const step = handleUnknownChat(pairing, chatId, name, text, Date.now(), () => String(randomInt(0, 1_000_000)).padStart(6, "0"));
  switch (step.kind) {
    case "issued":
      log(`Assistent: Kopplungsanfrage von Chat ${chatId} (${name}) – Code über die Cloud gemeldet`);
      recordHubEvent({ kind: "system", severity: "warn", where: "Assistent", title: `Kopplungsanfrage von ${name}`, detail: `Code ${step.code}` });
      await reportPairingCode(step.code);
      await sendText(chatId, "Hallo! Ich kenne diesen Chat noch nicht. Ich habe einen sechsstelligen Code über den EMP-Access-Alarmkanal (Push und Alarm-Telegram) geschickt. Bitte schick ihn mir hier.");
      return;
    case "pending":
      await sendText(chatId, "Bitte den sechsstelligen Code aus dem EMP-Access-Alarmkanal schicken.");
      return;
    case "wrong":
      await sendText(chatId, `Der Code stimmt nicht. Noch ${step.left} Versuche.`);
      return;
    case "locked":
      await sendText(chatId, "Zu viele falsche Versuche. In 15 Minuten geht es wieder.");
      return;
    case "paired":
      await saveStore();
      await reportPairingCode(null);
      log(`Assistent: Chat ${chatId} (${name}) gekoppelt`);
      recordHubEvent({ kind: "system", severity: "info", where: "Assistent", title: `Telegram-Chat gekoppelt: ${name}` });
      await sendText(
        chatId,
        "Gekoppelt. Ich bin der Assistent des Hubs und laufe lokal auf dem Mac Studio. Frag mich nach der Lage (/status), offenen Befunden (/befunde) oder sag mir, was ich schalten soll – Schaltbefehle bestätigst du per Knopf. Jeden Morgen um " +
          `${REPORT_TIME} schicke ich einen kurzen Bericht.`
      );
      return;
  }
}

/* ------------------------------------------------------------ Telegram-Schleife */

function enqueue(chatId: string, job: () => Promise<void>): void {
  const prev = queues.get(chatId) ?? Promise.resolve();
  const next = prev
    .then(job)
    .catch((e) => log(`Assistent: ${e instanceof Error ? e.message : e}`))
    .finally(() => {
      if (queues.get(chatId) === next) queues.delete(chatId);
    });
  queues.set(chatId, next);
}

async function onUpdate(u: TgUpdate): Promise<void> {
  if (u.callback_query) {
    const cb = u.callback_query;
    enqueue(String(cb.message?.chat.id ?? "cb"), () => handleCallback(cb));
    return;
  }
  const msg = u.message;
  if (!msg) return;
  const chatId = String(msg.chat.id);
  const text = (msg.text ?? msg.caption ?? "").trim();
  const name = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") || msg.from?.username || chatId;
  if (!isPaired(pairing, chatId, ENV_CHAT_IDS)) {
    enqueue(chatId, () => handleUnknown(chatId, msg.chat.type, name, text));
    return;
  }
  const voice = msg.voice ?? msg.audio;
  if (voice) {
    enqueue(chatId, () => handleVoice(chatId, voice));
    return;
  }
  if (msg.photo) {
    const photo = msg.photo;
    enqueue(chatId, () => handlePhoto(chatId, photo, text));
    return;
  }
  if (!text) return;
  enqueue(chatId, () => handleMessage(chatId, text));
}

async function handlePhoto(chatId: string, photo: Array<{ file_id: string; width: number }>, caption: string): Promise<void> {
  if (!VISION.ready) {
    await sendText(chatId, `Das Bildmodell ${VISION.installing ? "wird gerade eingerichtet" : `ist nicht bereit${VISION.error ? `: ${VISION.error}` : ""}`}.`);
    return;
  }
  await typing(chatId);
  try {
    const jpeg = await downloadPhoto(photo);
    if (!jpeg) throw new Error("Foto nicht abrufbar");
    const question = caption || "Beschreibe kurz, was auf dem Bild zu sehen ist.";
    const answer = await askVision(jpeg, `${question}\nAntworte kurz auf Deutsch.`);
    await sendText(chatId, answer || "Dazu fällt mir nichts ein.");
    const history = histories.get(chatId) ?? [];
    history.push({ role: "user", content: `[Foto]${caption ? ` ${caption}` : ""}` }, { role: "assistant", content: answer });
    histories.set(chatId, trimHistory(history));
  } catch (e) {
    await sendText(chatId, `Das Foto konnte ich nicht auswerten: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function handleVoice(chatId: string, voice: { file_id: string; duration: number }): Promise<void> {
  if (voice.duration > 300) {
    await sendText(chatId, "Die Sprachnachricht ist mir zu lang (über 5 Minuten). Bitte kürzer oder als Text.");
    return;
  }
  if (!VOICE.ready) {
    void ensureWhisper();
    const why = VOICE.installing ? "wird gerade eingerichtet" : `ist nicht bereit${VOICE.error ? `: ${VOICE.error}` : ""}`;
    await sendText(chatId, `Die Spracherkennung ${why}. Bitte schreib mir solange.`);
    return;
  }
  await typing(chatId);
  let text: string;
  try {
    const audio = await downloadFile(voice.file_id);
    if (!audio) throw new Error("Sprachnachricht nicht abrufbar");
    text = await transcribe(audio);
  } catch (e) {
    const msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
    log(`Assistent: Sprachnachricht: ${msg}`);
    await sendText(chatId, `Die Sprachnachricht konnte ich nicht verstehen: ${msg}`);
    return;
  }
  if (!text || /^\[(BLANK_AUDIO|Musik|Music)\]$/i.test(text)) {
    await sendText(chatId, "In der Sprachnachricht habe ich nichts verstanden.");
    return;
  }
  // Zur Kontrolle zeigen, was angekommen ist – dann wie eine Textnachricht.
  await sendText(chatId, `🎙 „${text}“`);
  await handleMessage(chatId, text);
}

async function pollLoop(): Promise<void> {
  let backoff = 2_000;
  for (;;) {
    try {
      const updates = await pollUpdates();
      backoff = 2_000;
      for (const u of updates) await onUpdate(u);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`Assistent: Telegram: ${msg}${/Conflict/.test(msg) ? " – läuft der Bot noch woanders (zweiter Hub, Webhook)?" : ""}`);
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 120_000);
    }
  }
}

/* ------------------------------------------------------------ Waechter */

const watch = newWatchState();
let deferred: Finding[] = [];

async function broadcast(text: string): Promise<void> {
  for (const id of chatIds()) {
    await sendText(id, text).catch((e) => log(`Assistent: Senden an ${id}: ${e instanceof Error ? e.message : e}`));
  }
}

async function watchTick(): Promise<void> {
  AGENT.lastWatchAt = new Date().toISOString();
  const diff = diffFindings(watch, collectFindings(), Date.now());
  const quiet = inQuietHours(QUIET, berlinHour());
  const now: Finding[] = [];
  for (const f of diff.opened) (quiet && f.severity !== "alert" ? deferred : now).push(f);
  if (!quiet && deferred.length) {
    const stillOpen = new Set(openFindings(watch).map((f) => f.key));
    now.unshift(...deferred.filter((f) => stillOpen.has(f.key)));
    deferred = [];
  }
  const deferredKeys = new Set(deferred.map((f) => f.key));
  const resolved = diff.resolved.filter((f) => !deferredKeys.has(f.key));
  deferred = deferred.filter((f) => !diff.resolved.some((r) => r.key === f.key));
  const lines: string[] = [];
  for (const f of now) lines.push(`${f.severity === "alert" ? "‼️" : "⚠️"} ${f.title}${f.detail ? `\n   ${f.detail}` : ""}`);
  for (const f of resolved) lines.push(`✅ Wieder in Ordnung: ${f.title} (nach ${Math.max(1, Math.round(f.sinceMs / 60_000))} min)`);
  if (lines.length && chatIds().length) await broadcast(lines.join("\n"));
}

/* ------------------------------------------------------------ Tagesbericht */

let lastReportDay: string | null = null;

async function dailyReport(): Promise<string> {
  const history: ChatMessage[] = [
    {
      role: "user",
      content:
        "Erstelle den Tagesbericht für Aaron. Hol dir dafür hub_status, improve_report und list_events (limit 60). " +
        "Aufbau: 1) Lage in zwei Sätzen. 2) Auffälligkeiten der letzten 24 Stunden (nur Belegtes). " +
        "3) Höchstens drei konkrete Vorschläge zur Optimierung, jeweils mit Begründung aus den Daten und wer es umsetzen muss. " +
        "Netzwerk-Änderungen nur als Vorschlag. Maximal 25 Zeilen. " +
        "Die Tagesvorschau (Buchungen, Wetter, Personal) bekommt Aaron separat, wiederhole sie nicht; " +
        "nutze day_preview nur, wenn ein Vorschlag davon abhängt (z. B. Personal zur Stoßzeit, Heizung oder Bewässerung nach Wetter).",
    },
  ];
  const text = await converse("report", history, false);
  AGENT.lastReportAt = new Date().toISOString();
  return `Tagesbericht ${new Date().toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })}\n\n${text}`;
}

async function reportTick(): Promise<void> {
  if (!chatIds().length) return;
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  if (lastReportDay === today || berlinHHMM() < REPORT_TIME) return;
  lastReportDay = today;
  await saveStore();
  // Erst die Tagesvorschau (feste Zahlen, ohne Sprachmodell), dann der Bericht.
  await broadcast(await dayPreviewText(0));
  if (!(await ensureOllama())) {
    await broadcast(`Tagesbericht ohne Sprachmodell (${LLM.error ?? "nicht bereit"}):\n\n${await plainStatus()}`);
    return;
  }
  try {
    await broadcast(await dailyReport());
  } catch (e) {
    log(`Assistent: Tagesbericht fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
    await broadcast(`Tagesbericht fehlgeschlagen, hier die Kurzlage:\n\n${await plainStatus()}`);
  }
}

/* ------------------------------------------------------------ Dashboard */

/** Kachel „KI-Assistent“ unter Systeme: Modell, Zustand, gekoppelte Chats. */
export function assistantHealth(): { state: "ok" | "warn" | "off"; value: string; detail: string } {
  if (!AGENT.enabled) return { state: "off", value: "aus", detail: "HUB_AGENT_TELEGRAM_TOKEN fehlt" };
  const chats = `${AGENT.pairedChats} Chat${AGENT.pairedChats === 1 ? "" : "s"}`;
  if (LLM.ready) {
    refreshLoadedModel();
    const ram = LLM_LOADED.loaded ? `im RAM (${(LLM_LOADED.sizeBytes / 1024 ** 3).toFixed(1)} GB)` : "entladen";
    const speed = LLM.lastReplyMs != null ? ` · Antwort ${(LLM.lastReplyMs / 1000).toFixed(1)} s` : "";
    const voice = VOICE.ready ? " · Sprache an" : VOICE.installing ? " · Sprache wird eingerichtet" : "";
    const eyes = VISION.ready
      ? ` · Bilder an${SENTINEL.enabled ? ` (Wächter ${SENTINEL.inspections}/${SENTINEL.alerts})` : ""}`
      : VISION.installing
        ? " · Bildmodell wird geladen"
        : "";
    return { state: "ok", value: LLM.model, detail: `${ram} · ${chats}${speed}${voice}${eyes}` };
  }
  if (LLM.installing) {
    const pct = LLM.pullPct != null ? ` ${LLM.pullPct} %` : "";
    return { state: "warn", value: LLM.model, detail: `${LLM.phase ?? "wird eingerichtet"}${pct} · ${chats}` };
  }
  return { state: "warn", value: LLM.model, detail: LLM.error ?? "nicht bereit" };
}

/* ------------------------------------------------------------ Start */

export async function startAgent(): Promise<void> {
  if (!telegramConfigured()) {
    log("Assistent: aus (HUB_AGENT_TELEGRAM_TOKEN fehlt in hub/.env)");
    return;
  }
  AGENT.enabled = true;
  await loadStore();
  log(`Assistent: an, ${TOOLS.length} Werkzeuge, ${AGENT.pairedChats} Chat(s) gekoppelt`);
  void setCommands();
  // Modell im Hintergrund bereitstellen; scheitert es, alle 30 min erneut.
  void ensureOllama();
  setInterval(() => {
    if (!LLM.ready) void ensureOllama();
  }, 30 * 60_000);
  // Kamera-Ereignisse ausserhalb des Betriebs selbst ansehen (Bildmodell).
  startSentinel({ chatIds, offer });
  // Sprachnachrichten: whisper.cpp + Modell im Hintergrund bereitstellen.
  void ensureWhisper();
  void pollLoop();
  setInterval(() => void watchTick().catch((e) => log(`Assistent: Wächter: ${e instanceof Error ? e.message : e}`)), WATCH_MS);
  setInterval(() => void reportTick().catch((e) => log(`Assistent: Bericht: ${e instanceof Error ? e.message : e}`)), 60_000);
}
