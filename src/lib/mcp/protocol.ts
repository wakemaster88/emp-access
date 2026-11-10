/**
 * Model Context Protocol (MCP) – schlanker Server-Kern ohne Abhängigkeiten.
 *
 * Wir sprechen den „Streamable HTTP“-Transport zustandslos: jede POST-Anfrage
 * enthält eine JSON-RPC-Nachricht, die Antwort kommt als `application/json`.
 * Ohne Sitzungen und ohne Server-Push (kein SSE), damit es auf Vercel ohne
 * Dauerverbindung läuft. Unterstützt werden `initialize`, `ping`,
 * `tools/list` und `tools/call`; Benachrichtigungen werden nur quittiert.
 *
 * Bewusst ohne Next.js und Prisma, damit die Regeln testbar bleiben.
 */

export const MCP_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;
export const MCP_LATEST_VERSION = MCP_PROTOCOL_VERSIONS[0];

/**
 * Berechtigungsstufe eines Tokens bzw. eines Werkzeugs. Netzwerk-Änderungen
 * gibt es auf keiner Stufe.
 *  - read:    nur lesen
 *  - operate: zusätzlich Raumgeräte (Licht, Markisen, Steckdosen, Mäher)
 *  - access:  zusätzlich Türen, Tore, Schlösser, Drehkreuze, Sirene
 */
export type McpLevel = "read" | "operate" | "access";
export const MCP_LEVELS: readonly McpLevel[] = ["read", "operate", "access"];

/**
 * Stufen, die in den Einstellungen angelegt werden dürfen. Aaron entscheidet,
 * ob Türen und Tore über MCP überhaupt schaltbar sein sollen.
 */
export const MCP_OFFERED_LEVELS: readonly McpLevel[] = ["read", "operate"];

export function isMcpLevel(v: unknown): v is McpLevel {
  return typeof v === "string" && (MCP_LEVELS as readonly string[]).includes(v);
}

/** Darf ein Token der Stufe `have` ein Werkzeug der Stufe `need` nutzen? */
export function levelAllows(have: McpLevel, need: McpLevel): boolean {
  return MCP_LEVELS.indexOf(have) >= MCP_LEVELS.indexOf(need);
}

export type McpContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface McpToolResult {
  content: McpContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/** Fehler, die als Werkzeug-Ergebnis (isError) an das Modell gehen, nicht als Protokollfehler. */
export class McpToolError extends Error {}

export interface McpTool<C> {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  level: McpLevel;
  /**
   * Feinere Stufe je Aufruf, z. B. Gerät schalten: Licht = operate,
   * Tür = access. Wird nach `level` geprüft; null = `level` reicht.
   */
  levelFor?: (args: Record<string, unknown>, ctx: C) => Promise<McpLevel | null>;
  run: (args: Record<string, unknown>, ctx: C) => Promise<McpToolResult | unknown>;
}

type JsonRpcId = string | number | null;

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export const RPC = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

export interface McpServerOptions<C> {
  tools: McpTool<C>[];
  ctx: C;
  level: McpLevel;
  serverInfo: { name: string; title?: string; version: string };
  instructions?: string;
  /** Wird nach jedem Werkzeugaufruf gerufen (Protokoll, Benachrichtigung). */
  onToolCall?: (info: McpToolCallInfo<C>) => void | Promise<void>;
}

export interface McpToolCallInfo<C> {
  tool: McpTool<C>;
  args: Record<string, unknown>;
  level: McpLevel;
  ok: boolean;
  error?: string;
}

export function rpcError(id: JsonRpcId, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Ergebnis eines Werkzeugs in das MCP-Format bringen (Text bzw. Bild). */
export function toToolResult(value: unknown): McpToolResult {
  if (isObject(value) && Array.isArray(value.content)) return value as unknown as McpToolResult;
  if (typeof value === "string") return { content: [{ type: "text", text: value }] };
  const text = JSON.stringify(value ?? null, null, 2);
  const result: McpToolResult = { content: [{ type: "text", text }] };
  if (isObject(value)) result.structuredContent = value;
  return result;
}

export function negotiateVersion(requested: unknown): string {
  return typeof requested === "string" && (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
    ? requested
    : MCP_LATEST_VERSION;
}

/** Werkzeuge, die ein Token der Stufe `level` sieht. */
export function visibleTools<C>(tools: McpTool<C>[], level: McpLevel): McpTool<C>[] {
  return tools.filter((t) => levelAllows(level, t.level));
}

function toolListEntry<C>(t: McpTool<C>) {
  return {
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: {
      title: t.title,
      readOnlyHint: t.level === "read",
      destructiveHint: t.level === "access",
      openWorldHint: false,
    },
  };
}

/**
 * Eine JSON-RPC-Nachricht verarbeiten. Gibt null zurück, wenn keine Antwort
 * nötig ist (Benachrichtigung oder Antwort des Clients).
 */
export async function handleMcpMessage<C>(msg: unknown, opts: McpServerOptions<C>): Promise<JsonRpcResponse | null> {
  if (!isObject(msg) || msg.jsonrpc !== "2.0") {
    return rpcError(null, RPC.INVALID_REQUEST, "Keine gültige JSON-RPC-2.0-Nachricht");
  }
  const hasId = "id" in msg && msg.id !== undefined;
  const id = (hasId ? msg.id : null) as JsonRpcId;
  if (typeof msg.method !== "string") {
    // Antworten des Clients (z. B. auf Rückfragen) erwarten wir nicht; ignorieren.
    return hasId && !("result" in msg || "error" in msg)
      ? rpcError(id, RPC.INVALID_REQUEST, "method fehlt")
      : null;
  }
  if (!hasId) return null; // Benachrichtigung (notifications/initialized u. a.)

  const params = isObject(msg.params) ? msg.params : {};

  switch (msg.method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: negotiateVersion(params.protocolVersion),
          capabilities: { tools: { listChanged: false } },
          serverInfo: opts.serverInfo,
          ...(opts.instructions ? { instructions: opts.instructions } : {}),
        },
      };
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return {
        jsonrpc: "2.0",
        id,
        result: { tools: visibleTools(opts.tools, opts.level).map(toolListEntry) },
      };
    case "tools/call": {
      const name = params.name;
      if (typeof name !== "string") return rpcError(id, RPC.INVALID_PARAMS, "name fehlt");
      const tool = opts.tools.find((t) => t.name === name);
      if (!tool) return rpcError(id, RPC.INVALID_PARAMS, `Unbekanntes Werkzeug: ${name}`);
      const args = isObject(params.arguments) ? params.arguments : {};
      if (!levelAllows(opts.level, tool.level)) {
        return {
          jsonrpc: "2.0",
          id,
          result: errorResult(`Dieses Token darf „${tool.title}“ nicht nutzen (Stufe ${tool.level} nötig).`),
        };
      }
      try {
        const need = tool.levelFor ? await tool.levelFor(args, opts.ctx) : null;
        if (need && !levelAllows(opts.level, need)) {
          const text = `Dieses Token darf das nicht (Stufe ${need} nötig). Türen, Tore, Schlösser, Drehkreuze und die Sirene brauchen ein Token mit Stufe „access“.`;
          await opts.onToolCall?.({ tool, args, level: opts.level, ok: false, error: text });
          return { jsonrpc: "2.0", id, result: errorResult(text) };
        }
        const value = await tool.run(args, opts.ctx);
        await opts.onToolCall?.({ tool, args, level: opts.level, ok: true });
        return { jsonrpc: "2.0", id, result: toToolResult(value) };
      } catch (e) {
        const text = e instanceof Error ? e.message : String(e);
        await opts.onToolCall?.({ tool, args, level: opts.level, ok: false, error: text });
        // Erwartete Fehler (Eingabe, Hub offline) gehen ans Modell; alles andere auch,
        // aber ohne Stacktrace.
        return { jsonrpc: "2.0", id, result: errorResult(e instanceof McpToolError ? text : `Fehler: ${text}`) };
      }
    }
    default:
      return rpcError(id, RPC.METHOD_NOT_FOUND, `Methode nicht unterstützt: ${msg.method}`);
  }
}

export function errorResult(text: string): McpToolResult {
  return { content: [{ type: "text", text }], isError: true };
}
