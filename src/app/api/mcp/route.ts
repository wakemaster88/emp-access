import { NextRequest, NextResponse } from "next/server";
import { tenantClient } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { authenticateMcpToken, mcpTokenFromRequest } from "@/lib/mcp/auth";
import { handleMcpMessage, rpcError, RPC, type JsonRpcResponse, type McpToolCallInfo } from "@/lib/mcp/protocol";
import { MCP_INSTRUCTIONS, MCP_TOOLS, type McpCtx } from "@/lib/mcp/tools";
import { notifyMcpAction } from "@/lib/mcp/notify";

export const dynamic = "force-dynamic";
// Hub-Werkzeuge warten bis zu 25 s auf den Hub.
export const maxDuration = 60;

/**
 * MCP-Schnittstelle (Model Context Protocol, Streamable HTTP, zustandslos).
 *
 * Für Claude und andere KI-Assistenten. Anmeldung mit einem MCP-Token aus
 * Einstellungen → MCP-Schnittstelle, als `Authorization: Bearer mcp_…` oder
 * – für Clients ohne eigene Kopfzeilen – als `?token=mcp_…` in der URL.
 * Die Stufe des Tokens (read/operate/access) bestimmt, welche Werkzeuge es
 * sieht und nutzen darf. Netzwerkänderungen gibt es auf keiner Stufe.
 */
export async function POST(request: NextRequest) {
  const token = mcpTokenFromRequest(request.headers, request.nextUrl);
  if (!token) return unauthorized("MCP-Token fehlt");

  const limit = checkRateLimit(`mcp:${token.slice(-12)}`, { limit: 120, windowMs: 60_000 });
  if (!limit.allowed) {
    return NextResponse.json(rpcError(null, RPC.INTERNAL_ERROR, "Zu viele Anfragen"), {
      status: 429,
      headers: { "Retry-After": String(limit.retryAfterSec) },
    });
  }

  const auth = await authenticateMcpToken(token);
  if (!auth) return unauthorized("MCP-Token ungültig oder widerrufen");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(rpcError(null, RPC.PARSE_ERROR, "Ungültiges JSON"), { status: 400 });
  }

  const ctx: McpCtx = { db: tenantClient(auth.accountId), accountId: auth.accountId, tokenName: auth.tokenName };
  const opts = {
    tools: MCP_TOOLS,
    ctx,
    level: auth.level,
    serverInfo: { name: "emp-access", title: "EMP-Access", version: "1.0.0" },
    instructions: MCP_INSTRUCTIONS,
    onToolCall: async (info: McpToolCallInfo<McpCtx>) => {
      console.log(
        `[mcp] ${auth.tokenName} (${auth.level}) ${info.tool.name} ${info.ok ? "ok" : `fehlgeschlagen: ${info.error}`}`,
      );
      if (info.ok && info.tool.level !== "read") {
        await notifyMcpAction(auth.accountId, auth.tokenName, info.tool.title, info.args).catch(() => undefined);
      }
    },
  };

  const messages = Array.isArray(body) ? body : [body];
  if (messages.length === 0 || messages.length > 20) {
    return NextResponse.json(rpcError(null, RPC.INVALID_REQUEST, "Leere oder zu große Anfrage"), { status: 400 });
  }
  const responses: JsonRpcResponse[] = [];
  for (const m of messages) {
    const r = await handleMcpMessage(m, opts);
    if (r) responses.push(r);
  }
  // Nur Benachrichtigungen/Antworten: 202 ohne Inhalt (Streamable HTTP).
  if (responses.length === 0) return new NextResponse(null, { status: 202 });
  return NextResponse.json(Array.isArray(body) ? responses : responses[0]);
}

/** Kein Server-Push (SSE): Clients fallen damit auf reine POST-Anfragen zurück. */
export async function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}

export async function DELETE() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}

function unauthorized(message: string) {
  return NextResponse.json(rpcError(null, RPC.INVALID_REQUEST, message), {
    status: 401,
    headers: { "WWW-Authenticate": 'Bearer realm="emp-access-mcp"' },
  });
}
