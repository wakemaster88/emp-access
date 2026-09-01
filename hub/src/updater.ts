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
    const local = await git(["rev-parse", "HEAD"]);
    const remote = await git(["rev-parse", "origin/main"]);
    if (local === remote) return;

    const dirty = await git(["status", "--porcelain", "--untracked-files=no"]);
    if (dirty) {
      log(`Update: lokale Aenderungen werden verworfen:\n${dirty}`);
    }
    log(`Update gefunden: ${local.slice(0, 7)} -> ${remote.slice(0, 7)}. reset --hard + Neustart …`);
    await git(["reset", "--hard", "origin/main"]);
    execSync("npm install --no-audit --no-fund", { cwd: CONFIG.hubDir, stdio: "inherit" });
    log("Update installiert – Prozess wird beendet (launchd startet neu).");
    process.exit(0);
  } catch (e) {
    log(`Update-Check fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
  }
}
