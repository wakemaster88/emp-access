import { execSync } from "node:child_process";
import { CONFIG, log } from "./config.js";

function git(args: string): string {
  return execSync(`git ${args}`, { cwd: CONFIG.repoDir, encoding: "utf8" }).trim();
}

/**
 * Selbst-Update ueber GitHub: Hub-Maschinen sind reine Deployment-Targets und
 * sollen exakt origin/main fahren. Lokale Aenderungen (z. B. Webcam-IP in
 * go2rtc.yaml ohne erfolgreichen Push) duerfen Updates nicht blockieren.
 *
 * Ablauf: fetch → bei Abweichung reset --hard → npm install → exit
 * (launchd KeepAlive startet neu).
 */
export function checkForUpdate(): void {
  try {
    git("fetch origin main --quiet");
    const local = git("rev-parse HEAD");
    const remote = git("rev-parse origin/main");
    if (local === remote) return;

    const dirty = git("status --porcelain --untracked-files=no");
    if (dirty) {
      log(`Update: lokale Aenderungen werden verworfen:\n${dirty}`);
    }
    log(`Update gefunden: ${local.slice(0, 7)} -> ${remote.slice(0, 7)}. reset --hard + Neustart …`);
    git("reset --hard origin/main");
    execSync("npm install --no-audit --no-fund", { cwd: CONFIG.hubDir, stdio: "inherit" });
    log("Update installiert – Prozess wird beendet (launchd startet neu).");
    process.exit(0);
  } catch (e) {
    log(`Update-Check fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
  }
}
