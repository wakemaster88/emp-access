/**
 * Systempflege des Hub-Macs, damit der Hub Nächte und Abmeldungen überlebt.
 *
 * Der Hub läuft ohne Root. Was er selbst kann: den Ruhezustand verhindern
 * (`caffeinate`, solange der Prozess lebt) und den Zustand von Auto-Login,
 * Ruhezustand und Einschaltplan ermitteln und in Heartbeat und Diagnose
 * melden. Was Root braucht (`pmset`), zieht er bei jedem Start nach, sobald
 * `install/setup-system.sh` einmal mit sudo gelaufen ist – das Skript legt
 * dafür eine sudoers-Regel nur für `/usr/bin/pmset` an. Auto-Login kann nur
 * das Skript setzen, weil dafür das Benutzerpasswort nötig ist.
 */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { log } from "./config.js";
import { STATE, recordHubEvent, type SystemState } from "./state.js";

const execFileAsync = promisify(execFile);

const ENABLED = process.env.HUB_POWER_SETUP !== "0";
const POWER_ON_TIME = /^\d{2}:\d{2}$/.test(process.env.HUB_POWER_ON_TIME ?? "")
  ? (process.env.HUB_POWER_ON_TIME as string)
  : "06:00";
const RECHECK_MS = 6 * 3_600_000;
const PMSET = "/usr/bin/pmset";

let caffeinateProc: ChildProcess | null = null;

async function out(cmd: string, args: string[]): Promise<{ ok: boolean; stdout: string }> {
  try {
    const r = await execFileAsync(cmd, args, { timeout: 10_000 });
    return { ok: true, stdout: r.stdout };
  } catch (e) {
    const err = e as { stdout?: string };
    return { ok: false, stdout: err.stdout ?? "" };
  }
}

async function readAutoLogin(): Promise<string | null> {
  const r = await out("defaults", ["read", "/Library/Preferences/com.apple.loginwindow", "autoLoginUser"]);
  const user = r.stdout.trim();
  return r.ok && user ? user : null;
}

/** FileVault-Status (ohne Root lesbar). Mit FileVault ist Auto-Login nicht möglich. */
async function readFileVault(): Promise<boolean | null> {
  const r = await out("fdesetup", ["status"]);
  if (!r.ok && !r.stdout) return null;
  if (/FileVault is On/i.test(r.stdout)) return true;
  if (/FileVault is Off/i.test(r.stdout)) return false;
  return null;
}

async function readPower(): Promise<{ sleep: number | null; autorestart: boolean | null }> {
  const r = await out(PMSET, ["-g"]);
  const sleep = /^\s*sleep\s+(\d+)/m.exec(r.stdout);
  const auto = /^\s*autorestart\s+(\d+)/m.exec(r.stdout);
  return {
    sleep: sleep ? Number(sleep[1]) : null,
    autorestart: auto ? auto[1] === "1" : null,
  };
}

async function readSchedule(): Promise<string | null> {
  const r = await out(PMSET, ["-g", "sched"]);
  const m = /wake(?:or)?poweron at (\S+)\s*(.*)/i.exec(r.stdout);
  return m ? `${m[1]} ${m[2]}`.trim() : null;
}

/** Darf dieser Benutzer pmset ohne Passwort? (sudoers-Regel aus setup-system.sh) */
async function sudoPmsetAllowed(): Promise<boolean> {
  const r = await out("sudo", ["-n", "-l", PMSET]);
  return r.ok;
}

function startCaffeinate(): boolean {
  if (caffeinateProc && caffeinateProc.exitCode === null) return true;
  try {
    // -i: kein Leerlauf-Ruhezustand, -s: kein System-Ruhezustand am Netzteil,
    // -w: endet automatisch mit dem Hub-Prozess.
    caffeinateProc = spawn("caffeinate", ["-i", "-s", "-w", String(process.pid)], {
      stdio: "ignore",
    });
    caffeinateProc.on("error", (e) => {
      log(`caffeinate nicht gestartet: ${e.message}`);
      caffeinateProc = null;
    });
    caffeinateProc.on("exit", () => {
      caffeinateProc = null;
    });
    return true;
  } catch (e) {
    log(`caffeinate nicht gestartet: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}

async function applyPower(): Promise<boolean> {
  const set = await out("sudo", ["-n", PMSET, "-a", "sleep", "0", "disksleep", "0", "displaysleep", "10", "autorestart", "1", "womp", "1"]);
  const rep = await out("sudo", ["-n", PMSET, "repeat", "wakeorpoweron", "MTWRFSU", `${POWER_ON_TIME}:00`]);
  if (!set.ok || !rep.ok) {
    log("Systempflege: pmset per sudo fehlgeschlagen – sudoers-Regel prüfen (install/setup-system.sh)");
    return false;
  }
  return true;
}

function buildHints(s: Omit<SystemState, "hints">): string[] {
  const hints: string[] = [];
  if (!s.autoLoginUser) {
    hints.push(
      s.fileVault
        ? "Auto-Login aus, weil FileVault an ist – nach einem Neustart wartet der Mac auf die Anmeldung. Entweder FileVault ausschalten (Systemeinstellungen → Datenschutz & Sicherheit) oder den Mac nie herunterfahren."
        : "Auto-Login aus – nach Abmeldung oder Neustart des Macs steht der Hub still (Systemeinstellungen → Benutzer & Gruppen → Automatisch anmelden, oder sudo install/setup-system.sh)"
    );
  }
  if (s.sleepMinutes !== 0) {
    hints.push(
      s.caffeinate
        ? `Ruhezustand nach ${s.sleepMinutes ?? "?"} min eingestellt – caffeinate hält wach, solange der Hub läuft`
        : `Ruhezustand nach ${s.sleepMinutes ?? "?"} min – Hub friert dann ein (sudo install/setup-system.sh)`
    );
  }
  if (!s.powerOnSchedule) {
    hints.push("Kein tägliches Einschalten geplant – nach Herunterfahren bleibt der Hub aus (sudo install/setup-system.sh)");
  }
  return hints;
}

/** Zustand ermitteln, was geht nachziehen, Ergebnis in STATE.system. */
export async function checkSystem(): Promise<SystemState | null> {
  if (process.platform !== "darwin") return null;
  const [autoLoginUser, fileVault, power, schedule, sudoPmset] = await Promise.all([
    readAutoLogin(),
    readFileVault(),
    readPower(),
    readSchedule(),
    sudoPmsetAllowed(),
  ]);

  let applied = false;
  let sleepMinutes = power.sleep;
  let autorestart = power.autorestart;
  let powerOnSchedule = schedule;
  const needsFix = sleepMinutes !== 0 || autorestart !== true || !powerOnSchedule;
  if (ENABLED && sudoPmset && needsFix) {
    applied = await applyPower();
    if (applied) {
      const again = await readPower();
      sleepMinutes = again.sleep;
      autorestart = again.autorestart;
      powerOnSchedule = await readSchedule();
      log(
        `Systempflege: pmset nachgezogen (kein Ruhezustand, Neustart nach Stromausfall, Einschalten täglich ${POWER_ON_TIME})`
      );
    }
  }

  const caffeinate = ENABLED ? startCaffeinate() : false;
  const base = {
    checkedAt: new Date().toISOString(),
    autoLoginUser,
    fileVault,
    sleepMinutes,
    autorestart,
    powerOnSchedule,
    caffeinate,
    sudoPmset,
    applied,
  };
  const state: SystemState = { ...base, hints: buildHints(base) };
  STATE.system = state;
  return state;
}

/** Beim Start und danach alle sechs Stunden; Hinweise einmal ins Log und in die Ereignisse. */
export function startSystemSetup(): void {
  if (process.platform !== "darwin") return;
  void checkSystem()
    .then((s) => {
      if (!s) return;
      const summary = [
        s.autoLoginUser ? `Auto-Login ${s.autoLoginUser}` : `Auto-Login aus${s.fileVault ? " (FileVault an)" : ""}`,
        s.sleepMinutes === 0 ? "kein Ruhezustand" : `Ruhezustand ${s.sleepMinutes ?? "?"} min`,
        s.powerOnSchedule ? `Einschalten ${s.powerOnSchedule}` : "kein Einschaltplan",
        s.caffeinate ? "caffeinate an" : "caffeinate aus",
        s.sudoPmset ? "pmset per sudo erlaubt" : "pmset ohne sudo-Regel",
      ].join(" · ");
      log(`Systempflege: ${summary}`);
      for (const h of s.hints) log(`Systempflege-Hinweis: ${h}`);
      recordHubEvent({
        kind: "system",
        severity: s.hints.length ? "warn" : "info",
        where: "Hub-Mac",
        title: s.hints.length ? "Systempflege unvollständig" : "Systempflege in Ordnung",
        detail: s.hints[0] ?? summary,
      });
    })
    .catch((e) => log(`Systempflege: ${e instanceof Error ? e.message : e}`));
  setInterval(() => {
    void checkSystem().catch(() => undefined);
  }, RECHECK_MS).unref();
}
