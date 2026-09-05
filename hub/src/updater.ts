import { execFile, execSync } from "node:child_process";
import { promisify } from "node:util";
import { CONFIG, gitHubCodeRevision, gitVersion, log } from "./config.js";

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
 * Ablauf: fetch → bei Abweichung reset --hard. Neu gestartet wird nur, wenn
 * sich unter hub/ etwas geaendert hat – ein Commit, der allein die Cloud
 * betrifft, laesst den Hub weiterlaufen (frueher startete jeder Push alle
 * Hubs neu). Der Checkout wird trotzdem nachgezogen, damit der Heartbeat den
 * aktuellen Stand meldet.
 *
 * git fetch ist async, damit DoorBird-Monitor und Polls nicht einfrieren.
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
      log(`Update gefunden: ${head.slice(0, 7)} -> ${remote.slice(0, 7)}. reset --hard …`);
      await git(["reset", "--hard", "origin/main"]);
      CONFIG.version = gitVersion();
    }

    // Neustart nur, wenn der laufende Prozess einen anderen hub/-Stand hat
    // als der Checkout – egal ob durch dieses Update oder ein manuelles pull.
    const hubRev = gitHubCodeRevision();
    if (hubRev === "unknown" || hubRev === CONFIG.hubCodeRevision) {
      if (head !== remote) log("Update betrifft nur die Cloud – Hub laeuft ohne Neustart weiter.");
      return;
    }

    log(`Hub-Code geaendert (${CONFIG.hubCodeRevision.slice(0, 7)} -> ${hubRev.slice(0, 7)}): npm install + Neustart …`);
    execSync("npm install --no-audit --no-fund", { cwd: CONFIG.hubDir, stdio: "inherit" });
    log("Neuer Stand installiert – Prozess wird beendet (launchd startet neu).");
    process.exit(0);
  } catch (e) {
    log(`Update-Check fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
  }
}
