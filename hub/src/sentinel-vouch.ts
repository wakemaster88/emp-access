/**
 * Beleg je Sichtung: Bewertet der Waechter mit Bildern gerade die Person, die
 * eine Kamera sieht (vouchFor in agent/sentinel-cover-rules.ts)? cameras.ts
 * fragt das unmittelbar vor dem Upload einer Personen-Sichtung und haengt nur
 * dann `sentinel=1` an. Nur mit diesem Beleg darf die Cloud zu einer
 * unbekannten Person schweigen (src/lib/hub-sentinel.ts).
 *
 * Ein eigenes Modul, weil agent/sentinel.ts cameras.ts importiert: cameras.ts
 * kann sentinel.ts nicht ohne Import-Zyklus einbinden. startSentinel traegt
 * die Abfrage ein. Ohne Eintrag oder wenn die Abfrage scheitert: kein Beleg.
 */
import type { Vouch } from "./agent/sentinel-cover-rules.js";

let check: ((cameraId: number) => Vouch) | null = null;

/** Abfrage des Waechters eintragen (startSentinel); null nimmt sie wieder heraus. */
export function setSentinelVouch(fn: ((cameraId: number) => Vouch) | null): void {
  check = fn;
}

/** Beleg fuer eine Sichtung an dieser Kamera, mit dem Stand von jetzt. */
export function sentinelVouch(cameraId: number): Vouch {
  if (!check) return { ok: false, listed: false, why: "Wächter nicht gestartet" };
  try {
    const v = check(cameraId);
    return { ok: v.ok === true, listed: v.listed === true, why: v.why };
  } catch (e) {
    return { ok: false, listed: false, why: `Abfrage gescheitert: ${e instanceof Error ? e.message : String(e)}` };
  }
}
