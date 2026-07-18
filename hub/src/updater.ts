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

    // Liegt der lokale Stand sauber hinter origin/main, reicht ein
    // fast-forward. Ist er abgewichen (z. B. Merge-Commit durch manuelles
    // "git pull"), wuerde der Hub sonst fuer immer auf altem Code haengen:
    // Ein Hub soll exakt origin/main fahren - bei unveraendertem
    // Arbeitsverzeichnis setzen wir deshalb hart zurueck.
    let behind = true;
    try {
      git(`merge-base --is-ancestor ${local} ${remote}`);
    } catch {
      behind = false;
    }

    if (behind) {
      log(`Update gefunden: ${local.slice(0, 7)} -> ${remote.slice(0, 7)}. Pull + Neustart …`);
      git("pull --ff-only origin main");
    } else {
      const dirty = git("status --porcelain --untracked-files=no");
      if (dirty) {
        log(`Update übersprungen: lokaler Stand ${local.slice(0, 7)} weicht ab und hat lokale Änderungen.`);
        return;
      }
      log(`Lokaler Stand ${local.slice(0, 7)} weicht von origin/main ab - reset --hard auf ${remote.slice(0, 7)} …`);
      git("reset --hard origin/main");
    }
    execSync("npm install --no-audit --no-fund", { cwd: CONFIG.hubDir, stdio: "inherit" });
    log("Update installiert – Prozess wird beendet (launchd startet neu).");
    process.exit(0);
  } catch (e) {
    log(`Update-Check fehlgeschlagen: ${e instanceof Error ? e.message : e}`);
  }
}
