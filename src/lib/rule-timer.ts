/**
 * Selbstabschaltung einer Regel-Aktion („Selbstabschaltung (Sek.)“ im
 * Regel-Dialog): Bei welchem Gerät und Befehl wirkt sie, und als was?
 *
 * Ohne Prisma und ohne Netzwerk, damit Regel-Dialog und Zusammenfassung
 * dieselbe Entscheidung zeigen, die die Regel-Engine beim Schalten trifft
 * (`triggerOptionsFor` in room-rules.ts). Der Hub spiegelt die Regel fuer
 * den Notbetrieb (hub/src/rooms-rules.ts, `ruleAutoOffSec`).
 *
 *  - GARDENA-Ventil: Laufzeit beim Starten (`seconds`).
 *  - Shelly mit Kategorie Schalter oder Beleuchtung: Timer im Geraet beim
 *    Einschalten (`autoOffSec`); das Relais faellt nach N Sekunden selbst
 *    ab, auch wenn die Verbindung danach abreisst.
 *  - Alles andere: keine. Ein Antrieb kennt seine Laufzeit selbst, Hue hat
 *    keinen Timer. Tuer, Drehkreuz, Taster und Shellys ohne Kategorie
 *    schalten einen festen Impuls; ein Regel-Timer hielte dort eine Tuer
 *    minutenlang offen oder einen Torkontakt geschlossen. NOT-AUF haelt
 *    bewusst dauerhaft offen und bekommt nie einen Timer.
 *
 * Ein schon gespeicherter Wert an einem anderen Geraet bleibt gespeichert
 * und wirkt nicht.
 */

export type RuleTimerKind = "seconds" | "autoOffSec";

/** Kategorien, die eingeschaltet bleiben, bis jemand ausschaltet (wie device-open.ts). */
const LATCHING_CATEGORIES = new Set(["SCHALTER", "BELEUCHTUNG"]);

export function ruleTimerKind(
  device: { type: string; category?: string | null },
  action: string | null | undefined,
): RuleTimerKind | null {
  if (device.type === "GARDENA_VALVE") return action === "open" || action === "emergency" ? "seconds" : null;
  if (device.type === "SHELLY" && LATCHING_CATEGORIES.has(device.category ?? "") && action === "open") {
    return "autoOffSec";
  }
  return null;
}

/** Wirkt eine eingetragene Selbstabschaltung bei diesem Geraet und Befehl? */
export function ruleTimerApplies(
  device: { type: string; category?: string | null } | null | undefined,
  action: string | null | undefined,
): boolean {
  return !!device && ruleTimerKind(device, action) !== null;
}
