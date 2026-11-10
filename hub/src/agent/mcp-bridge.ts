/**
 * Hub-Seite der MCP-Schnittstelle: fuehrt freigegebene Werkzeuge des
 * Hub-Assistenten fuer die Cloud aus (Hub-Task AGENT_TOOL).
 */
import { log } from "../config.js";
import { recordActivity } from "./activity.js";
import { checkBridgePayload, clipResult } from "./mcp-bridge-rules.js";
import { findTool } from "./tools.js";

export async function runMcpBridgeTask(
  payload: Record<string, unknown> | null
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const check = checkBridgePayload(payload);
  if (!check.ok) {
    log(`MCP: abgelehnt – ${check.error}`);
    return { success: false, error: check.error };
  }
  const tool = findTool(check.tool);
  if (!tool) return { success: false, error: `Werkzeug „${check.tool}“ fehlt auf dem Hub` };

  const label = tool.describe ? tool.describe(check.args) : check.tool;
  if (check.level !== "read") {
    log(`MCP: ${label}`);
    recordActivity({ kind: "action", text: `Über MCP: ${label}` });
  }
  try {
    // Bilder gehen bei MCP nicht nach Telegram; dafuer gibt es camera_snapshot.
    const result = await tool.run(check.args, { sendPhoto: async () => undefined });
    return { success: true, result: clipResult(result) };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log(`MCP: ${check.tool} fehlgeschlagen – ${error}`);
    return { success: false, error };
  }
}
