/**
 * Werkzeuge des Hub-Assistenten.
 *
 * Jedes Werkzeug hat eine Stufe:
 *  - "read": nur lesen, laeuft sofort.
 *  - "act":  schaltet etwas. Laeuft erst, wenn Aaron in Telegram auf
 *            „Ausführen“ tippt (agent.ts legt die Rueckfrage an).
 *
 * Bewusst NICHT vorhanden: Aenderungen an Router, Switches, VLANs, DHCP,
 * WLAN oder Firewall. Netzwerk-Aenderungen brauchen Aarons ausdrueckliches OK
 * und laufen nicht ueber den Assistenten – er darf sie nur vorschlagen.
 * Ebenso kein freier Shell-Befehl: nur die festen Hub-Aktionen.
 */
import { healthFindings, healthSummary } from "../health-trends.js";
import { readFile, appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { CONFIG } from "../config.js";
import { STATE, hubEventsSince } from "../state.js";
import { executeTask } from "../tasks.js";
import { captureSnapshot, findCameraByRef, listCameraStatus } from "../cameras.js";
import { captureDoorbirdSnapshot, isDoorbird, listDoorbirdStatus } from "../doorbird.js";
import { systemMetrics } from "../system-metrics.js";
import { deviceAction, liveStates, roomsPayload } from "../rooms.js";
import { climatePayload } from "../climate.js";
import { rulesStatus } from "../rules.js";
import { soundwebSummary } from "../soundweb.js";
import { mowerStatus } from "../mower.js";
import { lastScanResult } from "../scanner.js";
import { vlanCheckSummary } from "../vlan-check.js";
import { recentImproveEvents } from "../improve-log.js";
import { readHubLog } from "../hublog.js";
import { staffSummary } from "../staff.js";
import { LLM, askVision } from "./ollama.js";
import type { ToolSpec } from "./ollama.js";

export type ToolRisk = "read" | "act";

export interface ToolContext {
  sendPhoto: (jpeg: Buffer, caption: string) => Promise<void>;
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  risk: ToolRisk;
  /** Klartext fuer die Rueckfrage, z. B. „Licht Umkleide Damen einschalten“. */
  describe?: (args: Record<string, unknown>) => string;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

const obj = (props: Record<string, unknown> = {}, required: string[] = []) => ({
  type: "object",
  properties: props,
  required,
});
const str = (description: string, extra: Record<string, unknown> = {}) => ({ type: "string", description, ...extra });
const num = (description: string) => ({ type: "number", description });

const MB = 1024 * 1024;
const pct = (x: number | null | undefined) => (x == null ? null : Math.round(x * 1000) / 10);

function notesPath(): string {
  return path.join(CONFIG.hubDir, ".cache", "agent-notes.md");
}

export async function readNotes(): Promise<string> {
  try {
    const text = await readFile(notesPath(), "utf8");
    return text.length > 4000 ? text.slice(-4000) : text;
  } catch {
    return "";
  }
}

function cameraRef(args: Record<string, unknown>) {
  const ref = String(args.camera ?? "").trim();
  const cam = findCameraByRef(ref);
  if (!cam) {
    const names = listCameraStatus().map((c) => `${c.id} ${c.name}`).join(", ");
    throw new Error(`Kamera „${ref}“ unbekannt. Vorhanden: ${names}`);
  }
  return cam;
}

function allRoomDevices() {
  const p = roomsPayload();
  return [
    ...p.rooms.flatMap((r) => r.devices.map((d) => ({ ...d, room: r.name }))),
    ...(p.unassigned ?? []).map((d) => ({ ...d, room: null as string | null })),
  ];
}

function deviceByRef(ref: unknown) {
  const s = String(ref ?? "").trim();
  const all = allRoomDevices();
  const id = Number(s);
  const dev =
    (Number.isInteger(id) ? all.find((d) => d.id === id) : undefined) ??
    all.find((d) => d.name.toLowerCase() === s.toLowerCase());
  if (!dev) throw new Error(`Gerät „${s}“ unbekannt – erst list_rooms aufrufen`);
  return dev;
}

const ACTION_WORDS: Record<string, string> = {
  open: "einschalten/öffnen",
  deactivate: "ausschalten",
  close: "schließen/zufahren",
  stop: "anhalten",
};

export const TOOLS: AgentTool[] = [
  {
    name: "hub_status",
    description:
      "Gesamtlage des Hubs: Cloud-Verbindung, Systemlast (CPU, RAM, Platte), Kameras, DoorBird, Gesichts-/Kennzeichenerkennung, Park-Tracker, Soundweb, Regeln, Sprachmodell.",
    parameters: obj(),
    risk: "read",
    run: async () => {
      const m = systemMetrics();
      const cams = listCameraStatus();
      return {
        hub: { name: CONFIG.name, version: CONFIG.version, uptimeMin: Math.round(process.uptime() / 60) },
        cloud: STATE.heartbeat,
        system: {
          cpuPct: m.cpu.usage == null ? null : Math.round(m.cpu.usage * 100),
          loadPerCore: m.cpu.loadPerCore,
          ramPct: pct(m.memory.usage),
          ramUsedGB: Math.round(m.memory.usedBytes / 1024 / MB),
          ramTotalGB: Math.round(m.memory.totalBytes / 1024 / MB),
          diskPct: pct(m.disk?.usage),
        },
        cameras: {
          total: cams.length,
          reachable: cams.filter((c) => c.reachable).length,
          unreachable: cams.filter((c) => !c.reachable).map((c) => `${c.name} (${c.host}): ${c.lastError ?? "keine Antwort"}`),
        },
        doorbirds: listDoorbirdStatus().map((d) => ({ name: d.name, host: d.host, connected: d.connected })),
        face: STATE.face,
        alpr: STATE.alpr,
        parking: STATE.parking,
        soundweb: soundwebSummary(),
        rules: rulesStatus(),
        staff: (() => {
          const s = staffSummary();
          return { workingCount: s.workingCount, onBreakCount: s.onBreakCount, dataAgeMin: s.dataAgeMin, error: s.error };
        })(),
        llm: { model: LLM.model, ready: LLM.ready, lastReplyMs: LLM.lastReplyMs },
        system_setup: STATE.system ? { autoLogin: STATE.system.autoLoginUser, sleepMin: STATE.system.sleepMinutes, hints: STATE.system.hints } : null,
      };
    },
  },
  {
    name: "who_is_working",
    description:
      "Wer arbeitet gerade? Eingestempelte Mitarbeiter aus emp-control (Zeiterfassung) mit Bereich, Einstempelzeit, Pause und geplantem Schichtende, dazu heutige Schichten, deren Leute noch nicht eingestempelt sind. Nenne das Alter des Stands, wenn stale=true.",
    parameters: obj(),
    risk: "read",
    run: async () => staffSummary(),
  },
  {
    name: "list_cameras",
    description: "Alle Kameras mit ID, Name, IP, Erreichbarkeit, aktiven Erkennungen und letztem Ereignis.",
    parameters: obj(),
    risk: "read",
    run: async () =>
      listCameraStatus().map((c) => ({
        id: c.id,
        name: c.name,
        host: c.host,
        reachable: c.reachable,
        error: c.lastError,
        active: c.activeStates,
        lastEventAt: c.lastEventAt,
        lastPerson: c.lastPerson ? { at: c.lastPerson.at, name: (c.lastPerson as { name?: string }).name } : null,
        lastPlate: c.lastPlate ? { at: c.lastPlate.at, plate: (c.lastPlate as { plate?: string }).plate } : null,
      })),
  },
  {
    name: "camera_snapshot",
    description: "Aktuelles Standbild einer Kamera oder DoorBird aufnehmen und Aaron in Telegram schicken.",
    parameters: obj({ camera: str("Kamera-ID oder exakter Name") }, ["camera"]),
    risk: "read",
    run: async (args, ctx) => {
      const cam = cameraRef(args);
      const jpeg = isDoorbird(cam.id) ? await captureDoorbirdSnapshot(cam.id) : await captureSnapshot(cam.id);
      await ctx.sendPhoto(jpeg, `${cam.name} · ${new Date().toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin" })}`);
      return { sent: true, camera: cam.name };
    },
  },
  {
    name: "look_at_camera",
    description:
      "Aktuelles Bild einer Kamera selbst ansehen und eine Frage dazu beantworten (Bildmodell), z. B. ‚Ist jemand am Tor?‘ oder ‚Wie voll ist der Strand?‘. Schickt Aaron das Bild mit.",
    parameters: obj({ camera: str("Kamera-ID oder exakter Name"), question: str("Was soll ich auf dem Bild prüfen?") }, ["camera"]),
    risk: "read",
    run: async (args, ctx) => {
      const cam = cameraRef(args);
      const jpeg = isDoorbird(cam.id) ? await captureDoorbirdSnapshot(cam.id) : await captureSnapshot(cam.id);
      const q = String(args.question ?? "").trim() || "Was ist zu sehen? Fällt etwas auf?";
      await ctx.sendPhoto(jpeg, cam.name);
      const answer = await askVision(jpeg, `Bild der Kamera „${cam.name}“ einer Wasserski- und Freizeitanlage. ${q}\nAntworte kurz und sachlich auf Deutsch.`);
      return { camera: cam.name, answer };
    },
  },
  {
    name: "list_events",
    description: "Letzte Hub-Ereignisse (Kameras, Personen, Fahrzeuge, DoorBird, Netzwerk, System, Tasks).",
    parameters: obj({
      kind: str("Filter", { enum: ["camera", "person", "vehicle", "doorbird", "network", "system", "task"] }),
      limit: num("Anzahl, Vorgabe 30"),
    }),
    risk: "read",
    run: async (args) =>
      hubEventsSince(0, {
        kind: typeof args.kind === "string" ? args.kind : undefined,
        limit: Math.min(80, Number(args.limit) || 30),
      }).map((e) => ({ ts: e.ts, kind: e.kind, sev: e.severity, where: e.where, title: e.title, detail: e.detail, plate: e.plate })),
  },
  {
    name: "read_log",
    description: "Hub-Log lesen: letzte Zeilen, optional mit Suchbegriff. file: hub (Vorgabe), error, improve.",
    parameters: obj({
      file: str("hub | error | improve", { enum: ["hub", "error", "improve"] }),
      grep: str("Suchbegriff, z. B. Kameraname oder 'fehl'"),
      lines: num("Anzahl Zeilen, Vorgabe 60"),
    }),
    risk: "read",
    run: async (args) => {
      const r = await readHubLog({ file: args.file, grep: args.grep, lines: Math.min(150, Number(args.lines) || 60) });
      return r;
    },
  },
  {
    name: "list_rooms",
    description:
      "Räume mit Geräten (ID, Name, Typ, Kategorie), Live-Zustand (an/aus, Leistung), Betriebszeit offen/zu, Klima und Regeln.",
    parameters: obj({ room: str("Optional: nur dieser Raum (Name)") }),
    risk: "read",
    run: async (args) => {
      const live = await liveStates();
      const wanted = String(args.room ?? "").trim().toLowerCase();
      const p = roomsPayload();
      return {
        syncedAt: p.syncedAt,
        rooms: p.rooms
          .filter((r) => !wanted || r.name.toLowerCase().includes(wanted))
          .map((r) => ({
            id: r.id,
            name: r.name,
            open: r.operating?.open ?? null,
            climate: r.climate
              ? { target: r.climate.currentTargetC, tempC: r.climate.lastTempC, heating: r.climate.heating, error: r.climate.lastError }
              : null,
            devices: r.devices.map((d) => ({ id: d.id, name: d.name, type: d.type, category: d.category, ...live[d.id] })),
            cameras: r.cameras.map((c) => c.name),
            rules: r.rules.filter((x) => x.isActive).map((x) => x.name),
          })),
      };
    },
  },
  {
    name: "climate",
    description: "Temperatur- und Feuchtefühler im LAN mit letztem Messwert.",
    parameters: obj(),
    risk: "read",
    run: async () => climatePayload().sensors,
  },
  {
    name: "network_overview",
    description: "Netzwerk-Inventar des letzten Scans (Anzahl je VLAN, unbekannte Geräte) und VLAN-Prüfung der Switches. Nur lesen.",
    parameters: obj({ vlan: str("Optional: nur dieses VLAN (Name oder ID) im Detail") }),
    risk: "read",
    run: async (args) => {
      const scan = lastScanResult();
      const want = String(args.vlan ?? "").trim().toLowerCase();
      const byVlan: Record<string, number> = {};
      for (const d of scan.devices) {
        const k = d.vlanName ?? String(d.vlanId ?? "?");
        byVlan[k] = (byVlan[k] ?? 0) + 1;
      }
      const vc = vlanCheckSummary();
      return {
        lastRunAt: scan.lastRunAt,
        error: scan.error,
        devicesTotal: scan.devices.length,
        byVlan,
        detail: want
          ? scan.devices
              .filter((d) => String(d.vlanId) === want || (d.vlanName ?? "").toLowerCase() === want)
              .slice(0, 80)
              .map((d) => ({ ip: d.ip, mac: d.mac, host: d.hostname, vendor: d.vendor }))
          : undefined,
        vlanCheck: { issues: vc.hosts.filter((h) => !h.ok).map((h) => ({ switch: h.sysName ?? h.host, issues: h.issues })), confirmed: vc.confirmed },
      };
    },
  },
  {
    name: "ping",
    description: "Prüfen, ob eine IP oder ein Hostname im Netz antwortet.",
    parameters: obj({ host: str("IP oder Hostname") }, ["host"]),
    risk: "read",
    run: async (args) => (await executeTask({ id: -1, type: "PING", payload: { host: args.host } })).result,
  },
  {
    name: "mower_status",
    description: "Zustand der Mammotion-Mäher (Akku, Tätigkeit, Fehler).",
    parameters: obj(),
    risk: "read",
    run: async () => mowerStatus(),
  },
  {
    name: "early_warnings",
    description:
      "Frueherkennung aus den Verläufen der letzten 7 Tage: Geräte mit gehäuften Zeitüberschreitungen (Aussetzer pro Stunde/Tag, Vergleich zur Vorwoche), häufige Neustarts (Switches, Shellys, Hub-Mac), Switch-Port-Fehler und Flattern, Shelly-Temperaturen, Platten-Prognose und abgelaufene Anmeldungen. Dazu die aktiven Vorwarnungen.",
    parameters: obj(),
    risk: "read",
    run: async () => ({ ...healthSummary(), active: healthFindings(new Set()) }),
  },
  {
    name: "improve_report",
    description: "Verbesserungslog des Hubs: Zähler und Hinweise seit Start sowie letzte Diagnose-Ereignisse. Grundlage für Optimierungsvorschläge.",
    parameters: obj(),
    risk: "read",
    run: async () => ({ ...STATE.improve, recent: recentImproveEvents(40) }),
  },
  {
    name: "remember",
    description:
      "Etwas Dauerhaftes merken (Vorliebe von Aaron, Erkenntnis über die Anlage). Steht künftig im Kontext. Nur kurze Sätze.",
    parameters: obj({ note: str("Ein Satz") }, ["note"]),
    risk: "read",
    run: async (args) => {
      const note = String(args.note ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
      if (!note) throw new Error("Notiz leer");
      await mkdir(path.dirname(notesPath()), { recursive: true });
      await appendFile(notesPath(), `- ${new Date().toISOString().slice(0, 10)}: ${note}\n`, "utf8");
      return { saved: true };
    },
  },
  // ------------------------------------------------------------ Schalten
  {
    name: "switch_device",
    description:
      "Ein Gerät aus list_rooms schalten: open = ein/öffnen (bei Tür/Taster ein Impuls), deactivate = aus, close/stop = Rolltor/Markise zu bzw. anhalten. Braucht Aarons Bestätigung.",
    parameters: obj(
      {
        device: str("Geräte-ID oder exakter Name aus list_rooms"),
        action: str("open | deactivate | close | stop", { enum: ["open", "deactivate", "close", "stop"] }),
      },
      ["device", "action"]
    ),
    risk: "act",
    describe: (args) => {
      try {
        const d = deviceByRef(args.device);
        return `${d.name}${d.room ? ` (${d.room})` : ""}: ${ACTION_WORDS[String(args.action)] ?? args.action}`;
      } catch {
        return `Gerät ${args.device}: ${args.action}`;
      }
    },
    run: async (args) => {
      const d = deviceByRef(args.device);
      return deviceAction(d.id, String(args.action));
    },
  },
  {
    name: "camera_control",
    description:
      "Kamera steuern: spotlight (Licht), siren (Sirene), ir (Nachtsicht), ptz_preset (auf gespeicherte Position fahren). Braucht Aarons Bestätigung.",
    parameters: obj(
      {
        camera: str("Kamera-ID oder exakter Name"),
        what: str("spotlight | siren | ir | ptz_preset", { enum: ["spotlight", "siren", "ir", "ptz_preset"] }),
        on: { type: "boolean", description: "an/aus (spotlight, siren, ir)" },
        preset: num("Preset-Nummer (ptz_preset)"),
      },
      ["camera", "what"]
    ),
    risk: "act",
    describe: (args) => {
      const name = findCameraByRef(String(args.camera ?? ""))?.name ?? String(args.camera);
      const what = String(args.what);
      if (what === "ptz_preset") return `${name}: auf Preset ${args.preset} fahren`;
      return `${name}: ${what === "spotlight" ? "Licht" : what === "siren" ? "Sirene" : "Nachtsicht"} ${args.on === false ? "aus" : "an"}`;
    },
    run: async (args) => {
      const cam = cameraRef(args);
      const what = String(args.what);
      const on = args.on !== false;
      const map: Record<string, { type: string; payload: Record<string, unknown> }> = {
        spotlight: { type: "CAMERA_SPOTLIGHT", payload: { cameraId: cam.id, on } },
        siren: { type: "CAMERA_SIREN", payload: { cameraId: cam.id, on } },
        ir: { type: "CAMERA_IR", payload: { cameraId: cam.id, state: on ? "Auto" : "Off" } },
        ptz_preset: { type: "CAMERA_PTZ", payload: { cameraId: cam.id, op: "ToPos", presetId: Number(args.preset) } },
      };
      const t = map[what];
      if (!t) throw new Error("Unbekannte Kamera-Aktion");
      return executeTask({ id: -1, ...t });
    },
  },
  {
    name: "open_gate",
    description: "Tor/Tür an einer DoorBird öffnen (ein Impuls). Braucht Aarons Bestätigung.",
    parameters: obj({ camera: str("DoorBird-ID oder exakter Name") }, ["camera"]),
    risk: "act",
    describe: (args) => `Tor öffnen: ${findCameraByRef(String(args.camera ?? ""))?.name ?? args.camera}`,
    run: async (args) => {
      const cam = cameraRef(args);
      return executeTask({ id: -1, type: "DOORBIRD_OPEN", payload: { cameraId: cam.id } });
    },
  },
  {
    name: "mower_action",
    description: "Mäher steuern: start_task, pause, resume, stop, dock. Braucht Aarons Bestätigung.",
    parameters: obj(
      {
        mower: str("Gerätename des Mähers aus mower_status"),
        action: str("start_task | pause | resume | stop | dock", { enum: ["start_task", "pause", "resume", "stop", "dock"] }),
      },
      ["mower", "action"]
    ),
    risk: "act",
    describe: (args) => `Mäher ${args.mower}: ${args.action}`,
    run: async (args) => executeTask({ id: -1, type: "MOWER_ACTION", payload: { mower: args.mower, action: args.action } }),
  },
  {
    name: "restart_service",
    description: "Lokalen Dienst neu starten: tracker (YOLO-Park-/Personen-Tracker) oder hub (der Hub selbst). Braucht Aarons Bestätigung.",
    parameters: obj({ service: str("tracker | hub", { enum: ["tracker", "hub"] }) }, ["service"]),
    risk: "act",
    describe: (args) => `Dienst neu starten: ${args.service === "hub" ? "Hub" : "Tracker"}`,
    run: async (args) => executeTask({ id: -1, type: "SERVICE_RESTART", payload: { service: args.service } }),
  },
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

export function findTool(name: string): AgentTool | undefined {
  return BY_NAME.get(name);
}

export function toolSpecs(): ToolSpec[] {
  return TOOLS.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

/** Ergebnis fuer das Modell kuerzen – der Kontext ist begrenzt. */
export function toolResultText(result: unknown, max = 6000): string {
  let text: string;
  try {
    text = typeof result === "string" ? result : JSON.stringify(result);
  } catch {
    text = String(result);
  }
  return text.length > max ? `${text.slice(0, max)} … (gekürzt)` : text;
}
