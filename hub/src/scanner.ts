/**
 * Automatischer Netzwerk-Scan: liest periodisch die ARP-Tabelle aus und
 * meldet die gefundenen Geraete an die Cloud (/api/hub/scan), wo sie per
 * MAC-Adresse upserted werden.
 */
import { CONFIG, api, log } from "./config.js";
import { runNetworkScan } from "./tasks.js";
import { STATE } from "./state.js";

let busy = false;

export async function autoScan(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const scan = await runNetworkScan();
    if (!scan.success) {
      log(`Auto-Scan fehlgeschlagen: ${scan.error}`);
      STATE.autoScan = { lastRunAt: new Date().toISOString(), devices: 0, uploaded: false, error: scan.error ?? null };
      return;
    }

    const { count, devices } = scan.result as {
      count: number;
      devices: { ip: string; mac: string; iface: string | null }[];
    };

    const res = await api("/api/hub/scan", {
      method: "POST",
      body: JSON.stringify({ hubName: CONFIG.name, devices }),
    });
    if (!res.ok) {
      log(`Auto-Scan-Upload fehlgeschlagen: HTTP ${res.status}`);
      STATE.autoScan = { lastRunAt: new Date().toISOString(), devices: count, uploaded: false, error: `HTTP ${res.status}` };
      return;
    }
    const data = (await res.json()) as { processed?: number };
    log(`Auto-Scan: ${count} Geräte gefunden, ${data.processed ?? 0} in der Cloud aktualisiert.`);
    STATE.autoScan = { lastRunAt: new Date().toISOString(), devices: count, uploaded: true, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`Auto-Scan-Fehler: ${msg}`);
    STATE.autoScan = { lastRunAt: new Date().toISOString(), devices: 0, uploaded: false, error: msg };
  } finally {
    busy = false;
  }
}
