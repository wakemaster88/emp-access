import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { isMcpLevel, type McpLevel } from "./protocol";

/** Neues MCP-Token: `mcp_` + 43 Zeichen aus dem CSPRNG. */
export function newMcpToken(): string {
  return `mcp_${randomBytes(32).toString("base64url")}`;
}

export function hashMcpToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function mcpTokenHint(token: string): string {
  return `…${token.slice(-4)}`;
}

/** Token aus `Authorization: Bearer …` oder `?token=` (für Clients ohne eigene Kopfzeilen). */
export function mcpTokenFromRequest(headers: Headers, url: URL): string | null {
  const auth = headers.get("authorization");
  if (auth) {
    const m = auth.match(/^Bearer\s+(\S+)$/i);
    return m ? m[1] : null;
  }
  return url.searchParams.get("token");
}

export interface McpAuth {
  tokenId: number;
  tokenName: string;
  accountId: number;
  level: McpLevel;
}

const LAST_USED_EVERY_MS = 5 * 60_000;

export async function authenticateMcpToken(token: string): Promise<McpAuth | null> {
  if (!token.startsWith("mcp_") || token.length < 20 || token.length > 200) return null;
  const row = await prisma.mcpToken.findUnique({
    where: { tokenHash: hashMcpToken(token) },
    select: {
      id: true,
      name: true,
      level: true,
      accountId: true,
      revokedAt: true,
      lastUsedAt: true,
      account: { select: { isActive: true } },
    },
  });
  if (!row || row.revokedAt || !row.account.isActive) return null;
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > LAST_USED_EVERY_MS) {
    void prisma.mcpToken
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
  }
  return {
    tokenId: row.id,
    tokenName: row.name,
    accountId: row.accountId,
    level: isMcpLevel(row.level) ? row.level : "read",
  };
}
