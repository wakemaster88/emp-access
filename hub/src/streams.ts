/**
 * Lokale Stream-Konfiguration (go2rtc + Kiosk) bei Kamera-IP-Wechsel
 * nachziehen. Wird vom MAC-Re-Mapping in cameras.ts aufgerufen: Wenn eine
 * Kamera per DHCP eine neue IP bekommen hat, ersetzt der Hub die alte IP in
 *   - webcams/infra/go2rtc.yaml  (RTSP-Quellen fuer Live-Video)
 *   - webcams/config.json        (Kiosk-App-Konfiguration)
 * und laedt go2rtc per API neu, damit das Kontrollzentrum ohne manuellen
 * Eingriff weiter Live-Bilder bekommt. Alles best-effort: Fehler hier duerfen
 * das eigentliche Re-Mapping (Cloud/Hub) nie blockieren.
 */
import { promises as fs } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { CONFIG, log } from "./config.js";

const GO2RTC_URL = (process.env.HUB_GO2RTC_URL || "http://127.0.0.1:1984").replace(/\/$/, "");

/**
 * Exakte IP im Text ersetzen. Lookarounds verhindern Teil-Treffer
 * (z. B. darf "192.168.1.10" nicht in "192.168.1.107" matchen).
 */
function replaceIp(text: string, oldIp: string, newIp: string): { text: string; count: number } {
  const re = new RegExp(`(?<![\\d.])${oldIp.replace(/\./g, "\\.")}(?![\\d])`, "g");
  let count = 0;
  const replaced = text.replace(re, () => {
    count++;
    return newIp;
  });
  return { text: replaced, count };
}

async function rewriteFile(file: string, oldIp: string, newIp: string): Promise<number> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch {
    return 0; // Datei existiert auf diesem Host nicht – ok.
  }
  const { text: replaced, count } = replaceIp(text, oldIp, newIp);
  if (count === 0) return 0;
  await fs.writeFile(file, replaced, "utf8");
  return count;
}

async function restartGo2rtc(): Promise<boolean> {
  try {
    const res = await fetch(`${GO2RTC_URL}/api/restart`, {
      method: "POST",
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Alte IP in go2rtc-/Kiosk-Konfiguration durch die neue ersetzen und go2rtc
 * neu laden. Liefert true, wenn mindestens eine Datei angepasst wurde.
 */
export async function updateLocalStreams(oldIp: string, newIp: string): Promise<boolean> {
  const files = [
    path.join(CONFIG.repoDir, "webcams", "infra", "go2rtc.yaml"),
    path.join(CONFIG.repoDir, "webcams", "config.json"),
  ];

  let total = 0;
  for (const file of files) {
    try {
      const count = await rewriteFile(file, oldIp, newIp);
      if (count > 0) {
        total += count;
        log(`Stream-Konfig ${path.basename(file)}: ${count}× ${oldIp} → ${newIp}`);
      }
    } catch (e) {
      log(`Stream-Konfig ${path.basename(file)} nicht anpassbar: ${e instanceof Error ? e.message : e}`);
    }
  }

  if (total === 0) return false;

  // Die Dateien sind im Git-Repo versioniert. Ohne Commit+Push wuerde der
  // Auto-Updater (updater.ts) irgendwann ueber die lokalen Aenderungen
  // stolpern bzw. sie per reset --hard verwerfen. Best-effort: bei
  // fehlendem Push-Zugriff bleibt die Aenderung lokal wirksam.
  try {
    const rel = files.map((f) => path.relative(CONFIG.repoDir, f)).join(" ");
    execSync(
      `git add ${rel} && git commit -m "hub: Kamera-IP ${oldIp} → ${newIp} (MAC-Re-Mapping)" && git push origin main`,
      { cwd: CONFIG.repoDir, stdio: "pipe", timeout: 30_000 }
    );
    log(`Stream-Konfig committet + gepusht (${oldIp} → ${newIp})`);
  } catch (e) {
    log(`Stream-Konfig-Commit/Push fehlgeschlagen (Änderung lokal aktiv): ${e instanceof Error ? e.message : e}`);
  }

  const restarted = await restartGo2rtc();
  log(
    restarted
      ? `go2rtc neu geladen (${oldIp} → ${newIp})`
      : `go2rtc-Neustart fehlgeschlagen – Streams laufen ggf. bis zum naechsten Neustart auf der alten IP`
  );
  return true;
}
