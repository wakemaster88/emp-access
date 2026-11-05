/**
 * Daten fuer die Mitarbeiter-Ansicht und die Personal-Kachel der Zentrale
 * (GET /api/staff im Hub-Dashboard). Stempeldaten aus staff.ts, dazu was die
 * KI heute gesehen hat: Hub-Ereignisse (Gesicht, Waechter) und die
 * Wiedererkennung des Assistenten (agent/people.ts, nur lesend).
 */
import { hubEventsSince } from "./state.js";
import { staffOnShiftToday, staffState, staffWorking } from "./staff.js";
import { activeCleared } from "./agent/people.js";
import { buildStaffInsights, type StaffSighting } from "./staff-insights-rules.js";

export async function staffPayload(now = Date.now()) {
  const sightings: StaffSighting[] = [];
  for (const ev of hubEventsSince(0)) {
    if (!ev.where) continue;
    const at = Date.parse(ev.ts);
    if (ev.kind === "person") sightings.push({ at, camera: ev.where, origin: "face", title: ev.title, list: ev.list ?? null });
    else if (ev.kind === "camera" && ev.title.startsWith("Assistent:")) {
      sightings.push({ at, camera: ev.where, origin: "sentinel", title: ev.title, detail: ev.detail ?? null });
    }
  }
  for (const c of await activeCleared().catch(() => [])) {
    sightings.push({ at: c.at, camera: c.camera, origin: "cleared", title: c.label, kleidung: c.kleidung });
  }
  return {
    ...staffState(now),
    ...buildStaffInsights(staffWorking(), staffOnShiftToday(), sightings, now),
  };
}
