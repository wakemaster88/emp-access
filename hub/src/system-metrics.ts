/**
 * Leistungsdaten des Hub-Rechners fuer das lokale Dashboard.
 *
 * Schnelle Werte (CPU, Last, Prozess) kommen aus Node selbst und werden
 * im Takt gesampelt. Teure Werte (Speicher, Platte, Netzdurchsatz,
 * Sidecar-Prozesse) holen externe Kommandos in groesseren Abstaenden.
 * Alles best-effort: faellt eine Quelle aus, bleibt das Feld null.
 */
import { execFile } from "node:child_process";
import { cpus, freemem, loadavg, totalmem, uptime as osUptime } from "node:os";
import { promisify } from "node:util";
import { CONFIG } from "./config.js";

const exec = promisify(execFile);

/** CPU-Auslastung: alle 2 s ein Sample, daraus die Auslastung seit dem letzten. */
const CPU_SAMPLE_MS = 2_000;
/** Speicher und Netzdurchsatz: haeufig genug fuer eine Live-Anzeige. */
const FAST_REFRESH_MS = 5_000;
/** Platte und Prozessliste aendern sich langsam. */
const SLOW_REFRESH_MS = 30_000;

export interface ProcessInfo {
  label: string;
  pid: number;
  cpu: number;
  rssBytes: number;
}

export interface InterfaceRate {
  name: string;
  rxBytesPerSec: number;
  txBytesPerSec: number;
}

export interface SystemMetrics {
  cpu: {
    usage: number | null;
    cores: number;
    model: string;
    load1: number;
    load5: number;
    load15: number;
    /** Last pro Kern – ueber 1.0 wartet Arbeit. */
    loadPerCore: number;
  };
  memory: {
    totalBytes: number;
    usedBytes: number;
    usage: number;
    /** macOS: Anteil komprimierter Seiten, Hinweis auf Speicherdruck. */
    compressedBytes: number | null;
  };
  disk: {
    mount: string;
    totalBytes: number;
    usedBytes: number;
    usage: number;
  } | null;
  network: InterfaceRate[];
  hubProcess: {
    pid: number;
    cpu: number | null;
    rssBytes: number;
    uptimeSec: number;
  };
  processes: ProcessInfo[];
  hostUptimeSec: number;
}

/* ------------------------------------------------------------------- CPU */

let lastCpuTimes: { idle: number; total: number } | null = null;
let cpuUsage: number | null = null;

function cpuTimes(): { idle: number; total: number } {
  let idle = 0;
  let total = 0;
  for (const cpu of cpus()) {
    for (const [key, value] of Object.entries(cpu.times)) {
      total += value;
      if (key === "idle") idle += value;
    }
  }
  return { idle, total };
}

function sampleCpu(): void {
  const now = cpuTimes();
  if (lastCpuTimes) {
    const idle = now.idle - lastCpuTimes.idle;
    const total = now.total - lastCpuTimes.total;
    if (total > 0) cpuUsage = Math.max(0, Math.min(100, ((total - idle) / total) * 100));
  }
  lastCpuTimes = now;
}

/* --------------------------------------------------------- Hub-Prozess-CPU */

let lastProcCpu = process.cpuUsage();
let lastProcAt = Date.now();
let hubCpu: number | null = null;

function sampleProcess(): void {
  const now = process.cpuUsage();
  const at = Date.now();
  const elapsedUs = (at - lastProcAt) * 1000;
  if (elapsedUs > 0) {
    const usedUs = now.user - lastProcCpu.user + (now.system - lastProcCpu.system);
    hubCpu = Math.max(0, (usedUs / elapsedUs) * 100);
  }
  lastProcCpu = now;
  lastProcAt = at;
}

/* --------------------------------------------------------------- Speicher */

let memory: SystemMetrics["memory"] = {
  totalBytes: totalmem(),
  usedBytes: totalmem() - freemem(),
  usage: 0,
  compressedBytes: null,
};

/**
 * macOS zeigt fast nie freien Speicher – os.freemem() taugt daher nicht.
 * „Belegt" wie im Aktivitaetsmonitor: aktiv + wired + komprimiert.
 */
async function refreshMemory(): Promise<void> {
  const total = totalmem();
  try {
    const { stdout } = await exec("vm_stat", [], { timeout: 4000 });
    const pageSize = Number(stdout.match(/page size of (\d+) bytes/)?.[1] ?? 4096);
    const page = (label: string): number => {
      const m = stdout.match(new RegExp(`${label}:\\s+(\\d+)\\.`));
      return m ? Number(m[1]) * pageSize : 0;
    };
    const active = page("Pages active");
    const wired = page("Pages wired down");
    const compressed = page("Pages occupied by compressor");
    const used = active + wired + compressed;
    memory = {
      totalBytes: total,
      usedBytes: used,
      usage: total > 0 ? (used / total) * 100 : 0,
      compressedBytes: compressed,
    };
  } catch {
    const used = total - freemem();
    memory = {
      totalBytes: total,
      usedBytes: used,
      usage: total > 0 ? (used / total) * 100 : 0,
      compressedBytes: null,
    };
  }
}

/* ----------------------------------------------------------------- Platte */

let disk: SystemMetrics["disk"] = null;

async function refreshDisk(): Promise<void> {
  try {
    const { stdout } = await exec("df", ["-k", CONFIG.hubDir], { timeout: 5000 });
    const line = stdout.trim().split("\n").pop() ?? "";
    const cols = line.split(/\s+/);
    // Filesystem 1024-blocks Used Available Capacity … Mounted-on
    const totalKb = Number(cols[1]);
    const usedKb = Number(cols[2]);
    if (!Number.isFinite(totalKb) || totalKb <= 0) return;
    disk = {
      mount: cols[cols.length - 1] ?? "/",
      totalBytes: totalKb * 1024,
      usedBytes: usedKb * 1024,
      usage: (usedKb / totalKb) * 100,
    };
  } catch {
    // Platte bleibt unbekannt.
  }
}

/* ------------------------------------------------------------------- Netz */

let lastCounters = new Map<string, { rx: number; tx: number }>();
let lastCountersAt = 0;
let network: InterfaceRate[] = [];

/** Nur echte Netzwerkkarten – Loopback und Tunnel interessieren nicht. */
function isPhysical(name: string): boolean {
  return /^en\d+$/.test(name);
}

async function refreshNetwork(): Promise<void> {
  try {
    const { stdout } = await exec("netstat", ["-ibn"], { timeout: 5000 });
    const counters = new Map<string, { rx: number; tx: number }>();
    for (const line of stdout.split("\n")) {
      if (!line.includes("<Link#")) continue;
      const cols = line.trim().split(/\s+/);
      const name = cols[0];
      if (!isPhysical(name)) continue;
      // Ohne MAC-Spalte rutschen die Zaehler um eine Position nach links.
      const hasMac = /^[0-9a-f]{2}:/i.test(cols[3] ?? "");
      const rx = Number(cols[hasMac ? 6 : 5]);
      const tx = Number(cols[hasMac ? 9 : 8]);
      if (!Number.isFinite(rx) || !Number.isFinite(tx)) continue;
      counters.set(name, { rx, tx });
    }

    const now = Date.now();
    const seconds = (now - lastCountersAt) / 1000;
    if (lastCountersAt > 0 && seconds > 0) {
      const rates: InterfaceRate[] = [];
      for (const [name, value] of counters) {
        const prev = lastCounters.get(name);
        if (!prev) continue;
        // Zaehler laufen bei 32 Bit ueber – negative Differenzen verwerfen.
        const rx = Math.max(0, value.rx - prev.rx) / seconds;
        const tx = Math.max(0, value.tx - prev.tx) / seconds;
        if (rx > 0 || tx > 0) rates.push({ name, rxBytesPerSec: rx, txBytesPerSec: tx });
      }
      network = rates.sort((a, b) => b.rxBytesPerSec + b.txBytesPerSec - (a.rxBytesPerSec + a.txBytesPerSec));
    }
    lastCounters = counters;
    lastCountersAt = now;
  } catch {
    // Netzdurchsatz bleibt leer.
  }
}

/* -------------------------------------------------------------- Prozesse */

/** Was zum Hub gehoert und Rechenzeit kostet. */
const WATCHED: { label: string; match: RegExp }[] = [
  { label: "Face-Sidecar", match: /hub\/face\/server\.py/ },
  { label: "ALPR-Daemon", match: /hub\/alpr\/[\w-]+\.py/ },
  // Der YOLO-Tracker laeuft als uvicorn auf 8088 – „tracker" steht nicht in der Kommandozeile.
  { label: "Kamera-Tracker", match: /uvicorn\s+main:app.*8088|tracker\.py/ },
  { label: "go2rtc", match: /\/go2rtc(\s|$)/ },
  { label: "Kiosk-Server", match: /webcams\/(server|app)\.(js|mjs|ts)/ },
];

let processes: ProcessInfo[] = [];

async function refreshProcesses(): Promise<void> {
  try {
    const { stdout } = await exec("ps", ["-Ao", "pid=,pcpu=,rss=,args="], {
      timeout: 6000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const found = new Map<string, ProcessInfo>();
    for (const line of stdout.split("\n")) {
      const m = line.trim().match(/^(\d+)\s+([\d.]+)\s+(\d+)\s+(.*)$/);
      if (!m) continue;
      const [, pid, pcpu, rssKb, args] = m;
      if (Number(pid) === process.pid) continue;
      const hit = WATCHED.find((w) => w.match.test(args));
      if (!hit) continue;
      const entry: ProcessInfo = {
        label: hit.label,
        pid: Number(pid),
        cpu: Number(pcpu),
        rssBytes: Number(rssKb) * 1024,
      };
      // Mehrere Treffer (Wrapper, Suchbefehle): der groesste ist der Dienst.
      const previous = found.get(hit.label);
      if (!previous || entry.rssBytes > previous.rssBytes) found.set(hit.label, entry);
    }
    processes = [...found.values()].sort((a, b) => b.rssBytes - a.rssBytes);
  } catch {
    // Prozessliste bleibt leer.
  }
}

/* ------------------------------------------------------------------ API */

export function systemMetrics(): SystemMetrics {
  const list = cpus();
  const [load1, load5, load15] = loadavg();
  const cores = list.length || 1;
  return {
    cpu: {
      usage: cpuUsage,
      cores,
      model: list[0]?.model ?? "unbekannt",
      load1,
      load5,
      load15,
      loadPerCore: load1 / cores,
    },
    memory,
    disk,
    network,
    hubProcess: {
      pid: process.pid,
      cpu: hubCpu,
      rssBytes: process.memoryUsage.rss(),
      uptimeSec: Math.floor(process.uptime()),
    },
    processes,
    hostUptimeSec: Math.floor(osUptime()),
  };
}

export function startSystemMetrics(): void {
  sampleCpu();
  sampleProcess();
  setInterval(() => {
    sampleCpu();
    sampleProcess();
  }, CPU_SAMPLE_MS).unref();

  const fast = () => {
    void refreshMemory();
    void refreshNetwork();
  };
  const slow = () => {
    void refreshDisk();
    void refreshProcesses();
  };
  fast();
  slow();
  setInterval(fast, FAST_REFRESH_MS).unref();
  setInterval(slow, SLOW_REFRESH_MS).unref();
}
