/**
 * Abgleich der Raumdaten mit der Cloud (rooms.ts): Zeitpunkt eines Stands
 * aus dem Platten-Cache, Ergebnis einer Schaltung ueber die Cloud, ob eine
 * Schaltung der Cloud gemeldet wird und die Selbstabschaltung einer
 * Regel-Aktion. Reine Logik.
 */

/**
 * Zeitpunkt eines Stands aus dem Platten-Cache: der beim Abruf vermerkte
 * (syncedAt), bei einem aelteren Cache der Zeitpunkt der Cloud-Antwort (at).
 * null, wenn keiner lesbar ist; dann gilt der Stand als veraltet.
 */
export function cacheSyncedAt(data: { syncedAt?: unknown; at?: unknown }): string | null {
  for (const v of [data.syncedAt, data.at]) {
    if (typeof v === "string" && Number.isFinite(Date.parse(v))) return v;
  }
  return null;
}

/**
 * Ergebnis einer Schaltung ueber die Cloud (`POST /api/devices/:id/action`).
 * Die Cloud antwortet auch dann mit HTTP 200, wenn das Geraet den Befehl
 * nicht bekam: dann steht `sent: false` (Geraete mit Fernbefehl) oder ein
 * `error` in der Antwort. Erledigt ist es nur ohne beides; ein Pi holt seinen
 * Auftrag selbst ab und meldet kein `sent`.
 */
export function cloudActionOutcome(
  httpOk: boolean,
  status: number,
  body: { error?: unknown; sent?: unknown },
): { ok: true } | { ok: false; error: string } {
  const error = typeof body.error === "string" && body.error ? body.error : null;
  if (!httpOk) return { ok: false, error: error ?? `HTTP ${status}` };
  if (error) return { ok: false, error };
  if (body.sent === false) return { ok: false, error: "Gerät hat den Befehl nicht angenommen" };
  return { ok: true };
}

/**
 * Muss die Cloud von einer Schaltung erfahren? Nur wenn der Hub selbst im LAN
 * geschaltet hat und es gelang: Ueber die Cloud geschaltet startet sie ihre
 * Regeln „Geraet geschaltet“ selbst, ein Fehlschlag ist kein Schaltvorgang.
 */
export function shouldReportSwitch(outcome: { ok: boolean; via: "lokal" | "cloud" }): boolean {
  return outcome.ok && outcome.via === "lokal";
}

/** Kategorien, die eingeschaltet bleiben, bis jemand ausschaltet (wie die Cloud). */
const LATCHING = new Set(["SCHALTER", "BELEUCHTUNG"]);

/**
 * Selbstabschaltung einer Regel-Aktion beim lokalen Schalten (Notbetrieb):
 * nur Shelly-Schalter und -Beleuchtung beim Einschalten bekommen den Timer
 * der Aktion, wie in der Cloud (src/lib/rule-timer.ts). Sonst undefined: Es
 * gilt der Standard des Geraets (Impuls bei Tuer, Taster und Shellys ohne
 * Kategorie, kein Timer bei NOT-AUF und Hue).
 */
export function ruleAutoOffSec(
  device: { type: string; category: string | null },
  action: string,
  requested: number | null | undefined,
): number | undefined {
  if (requested == null || !Number.isFinite(requested) || requested <= 0) return undefined;
  if (device.type !== "SHELLY" || !LATCHING.has(device.category ?? "") || action !== "open") return undefined;
  return Math.round(requested);
}
