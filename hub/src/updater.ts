import { execSync } from "node:child_process";
import { CONFIG, log } from "./config.js";

function git(args: string): string {
  return execSync(`git ${args}`, { cwd: CONFIG.repoDir, encoding: "utf8" }).trim();
}

/**
 * Selbst-Update ueber GitHub: Wenn origin/main neue Commits hat, wird per
 * fast-forward gepullt, `npm install` im Hub-Ordner ausgefuehrt und der
 * Prozess beendet - launchd (KeepAlive) startet den Hub automatisch mit dem
 * neuen Code neu.
 */
export function checkForUpdate(): void {
  try {
    git("fetch origin main --quiet");
    const local = git("rev-parse HEAD");
    const remote = git("rev-parse origin/main");
    if (local === remote) return;

    log(`Update gefunden: ${local.slice(0, 7)} -> ${remote.slice(0, 7)}. Pull + Neustart …`);
    git("pull --ff-only origin main");
    execSync("npm install --no-audit --no-fund", { cwd: CONFIG.hubDir, stdio: "inherit" });
    log("Update installiert – Prozess wird beendet (launchd startet neu).");
    process.exit(0);
  } catch (e) {
    log(`Update-Check fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
  }
}
