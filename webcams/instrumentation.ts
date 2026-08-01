/**
 * Läuft einmal beim Start des Servers.
 *
 * Die übrige Hintergrundarbeit im Projekt startet lazy aus API-Routen und
 * hängt damit daran, dass jemand das Dashboard offen hat. Für die
 * Drehkreuz-Kontrolle reicht das nicht: Die soll auch dann anschlagen, wenn
 * abends niemand auf den Bildschirm schaut.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ensureTailgateStarted } = await import("./lib/tailgate");
  ensureTailgateStarted();
  void backfillScanArchive();
}

/** Wie weit beim Start nachgetragen wird. */
const BACKFILL_HOURS = 48;

/**
 * Holt die jüngste Vergangenheit aus der Cloud ins lokale Archiv.
 *
 * Nötig, weil der Server nur mitschreiben kann, während er läuft. Nach einem
 * Neustart — oder beim allerersten Start — klaffte sonst genau die Lücke, die
 * man später nachvollziehen will. Blättert nur so weit zurück, wie es das
 * Archiv noch nicht abdeckt.
 */
async function backfillScanArchive() {
  try {
    const { loadConfig } = await import("./lib/config");
    const cfg = await loadConfig();
    const emp = cfg.settings.empAccess;
    const token = emp.apiToken?.trim() ?? "";
    if (!emp.enabled || !token) return;

    const { archiveScans, cleanupScanArchive, readScansSince } = await import(
      "./lib/scan-archive"
    );
    const { fetchScanRowsSince } = await import("./lib/emp-access-scans");

    const want = Date.now() - BACKFILL_HOURS * 3600_000;
    const have = await readScansSince(want);
    // Ab dem jüngsten bekannten Scan reicht es — davor steht schon alles.
    const since = have.length > 0 ? Math.max(...have.map((s) => s.ts)) : want;

    const rows = await fetchScanRowsSince(emp.baseUrl, token, since);
    const written = await archiveScans(rows);
    const removed = await cleanupScanArchive();
    if (written > 0 || removed > 0) {
      console.log(
        `[scan-archive] ${written} Scans nachgetragen, ${removed} alte Tagesdateien entfernt`,
      );
    }
  } catch (e) {
    console.warn("[scan-archive] Nachtragen fehlgeschlagen", (e as Error).message);
  }
}
