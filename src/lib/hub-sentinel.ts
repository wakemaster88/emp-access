/**
 * Ein Meldeweg in der Nacht: Der Hub meldet mit seinem Lebenszeichen
 * (POST /api/hub/heartbeat, Feld `sentinel`), welche Kameras sein Wächter mit
 * Bildern gerade nachweislich bewacht (hub/src/agent/sentinel-cover-rules.ts).
 * Die Cloud legt das je Hub in HubAgent.status.sentinel ab.
 *
 * Die Cloud-Überwachung schweigt zu einer unbekannten Person nur, wenn beides
 * zusammenkommt: Die Sichtung selbst ist vom Hub als bewertet belegt
 * (`sentinel=1` am Upload, sentinelVouched; der Wächter bewertet genau diese
 * Person gerade oder hat sie gemeldet), und die Meldung des Hubs ist frisch
 * und nennt die Kamera (sentinelCovers). Dann meldet der Wächter. Gesperrte
 * Personen und Fahrzeuge meldet die Cloud immer selbst. Fehlt der Beleg
 * (auch bei einem älteren Hub) oder die Meldung, ist sie zu alt oder nennt
 * sie die Kamera nicht, meldet die Cloud wie bisher. Jede so unterbliebene
 * Meldung steht mit Kamera und Grund im Log (HUB_SENTINEL_LOG_TAG) und wird
 * je Hub gezählt.
 *
 * Reine Logik ohne Prisma.
 */

/**
 * So alt darf die Meldung des Hubs höchstens sein. Der Hub schickt sein
 * Lebenszeichen alle HUB_HEARTBEAT_INTERVAL Sekunden (hub/src/config.ts,
 * heartbeatIntervalMs, Standard 60 s) und sofort, wenn eine Kamera aus der
 * Liste fällt. Die Liste darin stammt aus einem Takt des Wächters, der
 * höchstens 30 s zurückliegt. Im Normalfall ist die abgelegte Meldung so
 * höchstens etwa 90 s alt. Fällt ein Lebenszeichen aus oder steht das
 * Intervall auf mehr als 2 min, ist die Meldung zu alt, und die Cloud meldet
 * selbst (sichere Seite).
 */
export const SENTINEL_REPORT_MAX_AGE_MS = 2 * 60_000;
/** Festes Kürzel der Log-Zeilen zu unterbliebenen Cloud-Meldungen. */
export const HUB_SENTINEL_LOG_TAG = "[surveillance hub-waechter]";
/** Mehr Kameras nimmt die Cloud aus einer Meldung nicht an. */
const MAX_CAMERAS = 500;

/** Meldung des Hubs, wie die Cloud sie ablegt. */
export interface SentinelReport {
  /**
   * Zeitpunkt der Meldung (ISO): der des Hubs, höchstens aber der Empfang in
   * der Cloud. Eine vorgehende Uhr des Hubs macht die Meldung so nie jünger.
   */
  at: string;
  /** Bewachte Kamera-IDs. */
  cameras: number[];
}

function cameraIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const ids = new Set<number>();
  for (const v of raw) {
    const id = Number(v);
    if (Number.isInteger(id) && id > 0) ids.add(id);
    if (ids.size >= MAX_CAMERAS) break;
  }
  return [...ids].sort((a, b) => a - b);
}

/**
 * Feld `sentinel` aus dem Lebenszeichen lesen. null = das Feld fehlt (älterer
 * Hub): Dann bleibt der abgelegte Stand, wie er ist, und veraltet. Ist es da,
 * aber unlesbar, gilt es als Meldung ohne Kamera: Die Cloud meldet dann
 * überall selbst.
 */
export function parseSentinelReport(raw: unknown, receivedAt: Date): SentinelReport | null {
  if (raw === undefined || raw === null) return null;
  const obj = typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const hubAt = typeof obj.at === "string" ? Date.parse(obj.at) : NaN;
  const at = Number.isFinite(hubAt) ? Math.min(hubAt, receivedAt.getTime()) : receivedAt.getTime();
  return { at: new Date(at).toISOString(), cameras: cameraIds(obj.cameras) };
}

/** Abgelegten Stand aus HubAgent.status lesen; null = keiner oder unlesbar. */
export function storedSentinelReport(status: unknown): SentinelReport | null {
  if (!status || typeof status !== "object" || Array.isArray(status)) return null;
  const raw = (status as Record<string, unknown>).sentinel;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.at !== "string" || !Number.isFinite(Date.parse(obj.at))) return null;
  return { at: obj.at, cameras: cameraIds(obj.cameras) };
}

/**
 * Bewacht der Wächter des Hubs diese Kamera nachweislich? Nur, wenn die
 * Meldung höchstens `maxAgeMs` alt ist und die Kamera nennt. Eine Meldung aus
 * der Zukunft (mehr als eine Minute) zählt nicht.
 */
export function sentinelCovers(opts: {
  cameraId: number;
  report: SentinelReport | null | undefined;
  now: Date;
  maxAgeMs: number;
}): boolean {
  const { report } = opts;
  if (!report) return false;
  const at = Date.parse(report.at);
  if (!Number.isFinite(at)) return false;
  const age = opts.now.getTime() - at;
  if (age > opts.maxAgeMs || age < -60_000) return false;
  return report.cameras.includes(opts.cameraId);
}

/**
 * Beleg des Hubs zu einer Personen-Sichtung (Query `sentinel` an
 * POST /api/hub/person-sightings): Nur genau "1" belegt, dass der Wächter
 * diese Person bewertet (hub/src/agent/sentinel-cover-rules.ts, vouchFor).
 * Fehlt der Parameter (älterer Hub) oder steht etwas anderes da, gibt es
 * keinen Beleg, und die Cloud meldet selbst.
 */
export function sentinelVouched(raw: string | null | undefined): boolean {
  return raw === "1";
}

/** Welcher Hub bewacht die Kamera (erster Treffer), und wie alt ist seine Meldung? */
export function coveringHub<H extends { name: string; status: unknown }>(
  hubs: readonly H[],
  cameraId: number,
  now: Date,
  maxAgeMs = SENTINEL_REPORT_MAX_AGE_MS,
): { hub: H; ageMs: number } | null {
  for (const hub of hubs) {
    const report = storedSentinelReport(hub.status);
    if (report && sentinelCovers({ cameraId, report, now, maxAgeMs })) {
      return { hub, ageMs: Math.max(0, now.getTime() - Date.parse(report.at)) };
    }
  }
  return null;
}

/** Log-Zeile zu einer unterbliebenen Cloud-Meldung, mit Kamera, Grund und laufender Nummer. */
export function mutedLine(opts: {
  accountId: number;
  cameraId: number;
  channel: "Push" | "Telegram";
  hubName: string;
  ageMs: number;
  count: number | null;
}): string {
  return (
    `${HUB_SENTINEL_LOG_TAG} account=${opts.accountId} Kamera ${opts.cameraId}: ${opts.channel} zu unbekannter Person nicht gesendet – ` +
    `Wächter des Hubs „${opts.hubName}“ bewacht die Kamera (Meldung vor ${Math.round(opts.ageMs / 1000)} s)` +
    (opts.count !== null ? `, Nr. ${opts.count}` : "")
  );
}
