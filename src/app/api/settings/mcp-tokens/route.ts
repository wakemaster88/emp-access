import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionWithDb } from "@/lib/api-auth";
import { hashMcpToken, mcpTokenHint, newMcpToken } from "@/lib/mcp/auth";
import { MCP_LEVELS, MCP_OFFERED_LEVELS } from "@/lib/mcp/protocol";

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  level: z.enum(MCP_LEVELS as unknown as ["read", "operate", "access"]).default("read"),
});

/** GET (Admin): MCP-Tokens des Mandanten, ohne Klartext. */
export async function GET() {
  const session = await getSessionWithDb({ requireAdmin: true });
  if ("error" in session) return session.error;
  if (!session.accountId) return NextResponse.json({ error: "Kein Mandant zugeordnet" }, { status: 403 });
  const tokens = await session.db.mcpToken.findMany({
    where: { accountId: session.accountId!, revokedAt: null },
    select: { id: true, name: true, hint: true, level: true, createdBy: true, lastUsedAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(tokens);
}

/** POST (Admin): neues Token anlegen. Der Klartext steht nur in dieser Antwort. */
export async function POST(request: NextRequest) {
  const session = await getSessionWithDb({ requireAdmin: true });
  if ("error" in session) return session.error;
  if (!session.accountId) return NextResponse.json({ error: "Kein Mandant zugeordnet" }, { status: 403 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Name fehlt oder Stufe ungültig" }, { status: 400 });
  if (!MCP_OFFERED_LEVELS.includes(parsed.data.level)) {
    return NextResponse.json({ error: "Diese Stufe ist nicht freigegeben" }, { status: 400 });
  }

  const active = await session.db.mcpToken.count({ where: { accountId: session.accountId!, revokedAt: null } });
  if (active >= 20) return NextResponse.json({ error: "Höchstens 20 aktive Tokens" }, { status: 400 });

  const token = newMcpToken();
  const row = await session.db.mcpToken.create({
    data: {
      accountId: session.accountId!,
      name: parsed.data.name,
      level: parsed.data.level,
      tokenHash: hashMcpToken(token),
      hint: mcpTokenHint(token),
      createdBy: session.session.user.email ?? session.session.user.name ?? null,
    },
    select: { id: true, name: true, hint: true, level: true, createdBy: true, lastUsedAt: true, createdAt: true },
  });
  return NextResponse.json({ ...row, token }, { status: 201 });
}
