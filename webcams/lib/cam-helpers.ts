import { loadConfig } from "./config";
import type { Cam } from "./types";

export async function getCamOrThrow(id: string): Promise<Cam> {
  const config = await loadConfig();
  const cam = config.cams.find((c) => c.id === id);
  if (!cam) throw new Error(`cam ${id} not found`);
  if (!cam.enabled) throw new Error(`cam ${id} disabled`);
  return cam;
}

/**
 * Macht ein Kamera-Update speicherbar, ohne die lokale config.json
 * wegen fehlender UI-Klicks zu verwerfen.
 *
 * Drehkreuz-Kontrolle braucht Crossing + Linie: wenn die Kontrolle an ist,
 * ziehen wir den Zähler und eine schon gespeicherte Linie nach. Leeres
 * Passwort / "***" bleibt das bisherige Passwort.
 */
export function prepareCamForSave(incoming: unknown, existing: Cam | null): unknown {
  if (!incoming || typeof incoming !== "object") return incoming;
  const c = { ...(incoming as Record<string, unknown>) };
  const prevPc = existing?.peopleCounter;
  const rawPc =
    c.peopleCounter && typeof c.peopleCounter === "object"
      ? (c.peopleCounter as Cam["peopleCounter"])
      : undefined;
  const rawTg =
    c.tailgate && typeof c.tailgate === "object"
      ? (c.tailgate as Cam["tailgate"])
      : undefined;

  if (
    existing &&
    typeof c.password === "string" &&
    (c.password === "***" || c.password.length === 0)
  ) {
    c.password = existing.password;
  }

  if (rawTg?.enabled) {
    const line = rawPc?.line ?? prevPc?.line ?? null;
    c.peopleCounter = {
      intervalSec: rawPc?.intervalSec ?? prevPc?.intervalSec ?? 60,
      direction: rawPc?.direction ?? prevPc?.direction ?? "ab",
      ...rawPc,
      enabled: true,
      mode: "crossing",
      line,
    };
    const ids = rawTg.deviceIds?.length
      ? rawTg.deviceIds
      : (existing?.tailgate.deviceIds ?? []);
    c.tailgate = { ...rawTg, deviceIds: ids };
  }

  return c;
}
