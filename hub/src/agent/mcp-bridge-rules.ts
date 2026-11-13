/**
 * Freigabeliste fuer Werkzeuge, die die Cloud ueber die MCP-Schnittstelle
 * (/api/mcp) als Hub-Task AGENT_TOOL anfragt.
 *
 * Die Cloud prueft die Token-Stufe schon; der Hub prueft hier ein zweites Mal
 * und fuehrt nur, was in der Liste steht. Muss zu MCP_HUB_TOOL_LEVELS in
 * src/lib/mcp/tools.ts passen.
 *
 * Bewusst NICHT freigegeben: switch_device (schaltet die Cloud selbst),
 * remember, ping, restart_service, set_occupancy_threshold, energy_*,
 * mower_skip_task, mower_relogin, Bild-Werkzeuge (eigener Task CAMERA_SNAPSHOT)
 * und alles, was das Netzwerk aendert (gibt es ohnehin nicht).
 */
export type McpLevel = "read" | "operate" | "access";

const LEVELS: McpLevel[] = ["read", "operate", "access"];

export const MCP_BRIDGE_TOOLS: Record<string, McpLevel> = {
  hub_status: "read",
  who_is_working: "read",
  occupancy: "read",
  day_preview: "read",
  list_cameras: "read",
  list_events: "read",
  list_rooms: "read",
  climate: "read",
  network_overview: "read",
  early_warnings: "read",
  weather_forecast: "read",
  energy_plan: "read",
  mower_status: "read",
  read_log: "read",
  improve_report: "read",
  mower_action: "operate",
  camera_control: "operate",
  open_gate: "access",
};

function isLevel(v: unknown): v is McpLevel {
  return typeof v === "string" && (LEVELS as string[]).includes(v);
}

/** Stufe, die dieser Aufruf braucht (Sirene ist strenger als Licht). */
export function requiredLevel(tool: string, args: Record<string, unknown>): McpLevel | null {
  const base = MCP_BRIDGE_TOOLS[tool];
  if (!base) return null;
  if (tool === "camera_control" && String(args.what) === "siren") return "access";
  return base;
}

export type BridgeCheck =
  | { ok: true; tool: string; args: Record<string, unknown>; level: McpLevel }
  | { ok: false; error: string };

/** Payload eines AGENT_TOOL-Tasks pruefen. */
export function checkBridgePayload(payload: Record<string, unknown> | null, now = Date.now()): BridgeCheck {
  const tool = String(payload?.tool ?? "");
  const args = payload?.args && typeof payload.args === "object" && !Array.isArray(payload.args)
    ? (payload.args as Record<string, unknown>)
    : {};
  const granted = payload?.level;
  if (!isLevel(granted)) return { ok: false, error: "Stufe fehlt" };
  const need = requiredLevel(tool, args);
  if (!need) return { ok: false, error: `Werkzeug „${tool}“ ist für MCP nicht freigegeben` };
  if (LEVELS.indexOf(granted) < LEVELS.indexOf(need)) {
    return { ok: false, error: `Werkzeug „${tool}“ braucht Stufe ${need}` };
  }
  // Abgelaufene Anfragen nicht nachholen: Ein Tor soll nicht Minuten nach der
  // Frage aufgehen, nur weil der Hub kurz weg war.
  const expires = Date.parse(String(payload?.expiresAt ?? ""));
  if (!Number.isFinite(expires)) return { ok: false, error: "Ablaufzeit fehlt" };
  if (now > expires) return { ok: false, error: "Anfrage abgelaufen" };
  return { ok: true, tool, args, level: need };
}

/** Ergebnis fuer die Cloud begrenzen (landet als JSON in der Datenbank). */
export function clipResult(result: unknown, maxChars = 60_000): unknown {
  let text: string;
  try {
    text = JSON.stringify(result ?? null);
  } catch {
    return String(result);
  }
  if (text.length <= maxChars) return result ?? null;
  return { truncated: true, text: `${text.slice(0, maxChars)} … (gekürzt)` };
}
