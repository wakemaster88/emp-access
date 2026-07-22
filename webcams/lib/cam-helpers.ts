import { loadConfig } from "./config";
import type { Cam } from "./types";

export async function getCamOrThrow(id: string): Promise<Cam> {
  const config = await loadConfig();
  const cam = config.cams.find((c) => c.id === id);
  if (!cam) throw new Error(`cam ${id} not found`);
  if (!cam.enabled) throw new Error(`cam ${id} disabled`);
  return cam;
}
