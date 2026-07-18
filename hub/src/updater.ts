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

    // Nur updaten, wenn origin/main wirklich neuere Commits hat. Ist der
    // lokale Stand voraus (z. B. Entwicklung vor dem Push), nichts tun –
    // sonst beendet sich der Hub in einer Endlosschleife.
    try {
      git(`merge-base --is-ancestor ${local} ${remote}`);
    } catch {
      log(`Update übersprungen: lokaler Stand ${local.slice(0, 7)} ist origin/main voraus.`);
      return;
    }

    log(`Update gefunden: ${local.slice(0, 7)} -> ${remote.slice(0, 7)}. Pull + Neustart …`);
    git("pull --ff-only origin main");
    execSync("npm install --no-audit --no-fund", { cwd: CONFIG.hubDir, stdio: "inherit" });
    log("Update installiert – Prozess wird beendet (launchd startet neu).");
    process.exit(0);
  } catch (e) {
    log(`Update-Check fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
  }
}
