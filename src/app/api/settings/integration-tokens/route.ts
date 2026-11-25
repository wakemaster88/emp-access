import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionWithDb } from "@/lib/api-auth";
import {
  hashIntegrationToken,
  integrationTokenPrefix,
  isIntegrationScope,
  newIntegrationToken,
  normalizeIntegrationScopes,
} from "@/lib/integration-token";

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  scopes: z.array(z.string()).min(1).max(10),
});

const rowSelect = {
  id: true,
  name: true,
  prefix: true,
  scopes: true,
  lastUsedAt: true,
  createdAt: true,
} as const;

/** GET (Admin): Integrations-Tokens des Mandanten, ohne Klartext. */
export async function GET() {
  const session = await getSessionWithDb({ requireAdmin: true });
  if ("error" in session) return session.error;
  if (!session.accountId) return NextResponse.json({ error: "Kein Mandant zugeordnet" }, { status: 403 });
  const tokens = await session.db.integrationToken.findMany({
    where: { accountId: session.accountId!, revokedAt: null },
    select: rowSelect,
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
  if (!parsed.success || !parsed.data.scopes.every(isIntegrationScope)) {
    return NextResponse.json({ error: "Name fehlt oder Bereich der Freigabe ungültig" }, { status: 400 });
  }
  const scopes = normalizeIntegrationScopes(parsed.data.scopes);

  const active = await session.db.integrationToken.count({
    where: { accountId: session.accountId!, revokedAt: null },
  });
  if (active >= 20) return NextResponse.json({ error: "Höchstens 20 aktive Tokens" }, { status: 400 });

  const adminId = Number(session.session.user.id);
  const token = newIntegrationToken();
  const row = await session.db.integrationToken.create({
    data: {
      accountId: session.accountId!,
      name: parsed.data.name,
      scopes,
      tokenHash: hashIntegrationToken(token),
      prefix: integrationTokenPrefix(token),
      createdByAdminId: Number.isInteger(adminId) ? adminId : null,
    },
    select: rowSelect,
  });
  console.info(
    `[integration-token] angelegt id=${row.id} account=${session.accountId} scopes=${scopes.join(",")} admin=${Number.isInteger(adminId) ? adminId : "-"}`,
  );
  return NextResponse.json({ ...row, token }, { status: 201 });
}
