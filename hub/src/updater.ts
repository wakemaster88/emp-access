import { execFile, execSync } from "node:child_process";
import { promisify } from "node:util";
import { CONFIG, log } from "./config.js";

const execFileAsync = promisify(execFile);

async function git(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: CONFIG.repoDir,
    timeout: 60_000,
  });
  return stdout.trim();
}

/**
 * Laeuft dieser Prozess noch auf dem Commit, der ausgecheckt ist?
 *
 * `CONFIG.version` wird beim Start einmal ermittelt. Wandert der Checkout
 * danach weiter – lokaler Commit auf der Entwicklermaschine, manuelles
 * `git pull` auf einem Hub – dann arbeitet der Prozess mit altem Code und
 * meldet trotzdem eine Version, die niemand mehr faehrt.
 */
function startedOnCommit(headSha: string): boolean {
  const started = CONFIG.version;
  // "unknown" oder verdaechtig kurz: keine belastbare Aussage, nicht neu starten.
  if (!started || started === "unknown" || started.length < 7) return true;
  return headSha.startsWith(started);
}

/**
 * Selbst-Update ueber GitHub: Hub-Maschinen sind reine Deployment-Targets und
 * sollen exakt origin/main fahren. Lokale Aenderungen (z. B. Webcam-IP in
 * go2rtc.yaml ohne erfolgreichen Push) duerfen Updates nicht blockieren.
 *
 * Ablauf: fetch → bei Abweichung reset --hard → npm install → exit
 * (launchd KeepAlive startet neu). git fetch ist async, damit DoorBird-
 * Monitor und Polls nicht einfrieren.
 */
export async function checkForUpdate(): Promise<void> {
  try {
    await git(["fetch", "origin", "main", "--quiet"]);
    const head = await git(["rev-parse", "HEAD"]);
    const remote = await git(["rev-parse", "origin/main"]);

    if (head !== remote) {
      const dirty = await git(["status", "--porcelain", "--untracked-files=no"]);
      if (dirty) {
        log(`Update: lokale Aenderungen werden verworfen:\n${dirty}`);
      }
      log(`Update gefunden: ${head.slice(0, 7)} -> ${remote.slice(0, 7)}. reset --hard + Neustart …`);
      await git(["reset", "--hard", "origin/main"]);
    } else if (!startedOnCommit(head)) {
      log(`Checkout ist weiter als der laufende Prozess (${CONFIG.version} -> ${head.slice(0, 7)}). Neustart …`);
    } else {
      return;
    }

    execSync("npm install --no-audit --no-fund", { cwd: CONFIG.hubDir, stdio: "inherit" });
    log("Neuer Stand installiert – Prozess wird beendet (launchd startet neu).");
    process.exit(0);
  } catch (e) {
    log(`Update-Check fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
  }
}
