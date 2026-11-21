import { NextRequest, NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";

/**
 * Mahnlauf ein- oder ausschalten (lib/dunning). Liegt im anny-Zugang unter
 * `extraConfig.dunning.enabled`; die übrigen anny-Einstellungen bleiben.
 */
export async function PATCH(request: NextRequest) {
  const session = await getSessionWithDb({ requireAdmin: true });
  if ("error" in session) return session.error;
  const { db, accountId, isSuperAdmin } = session;
  if (isSuperAdmin || !accountId) return NextResponse.json({ error: "Nur im eigenen Konto" }, { status: 400 });

  const body = await request.json().catch(() => null);
  if (typeof body?.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled fehlt" }, { status: 400 });
  }

  const config = await db.apiConfig.findFirst({ where: { accountId, provider: "ANNY" }, select: { id: true, extraConfig: true } });
  if (!config) return NextResponse.json({ error: "anny ist nicht eingerichtet" }, { status: 404 });

  let extra: Record<string, unknown> = {};
  try {
    if (config.extraConfig) extra = JSON.parse(config.extraConfig);
  } catch { /* unlesbar: neu anlegen wäre zu riskant */
    return NextResponse.json({ error: "anny-Einstellungen sind unlesbar" }, { status: 500 });
  }
  const prev = (extra.dunning && typeof extra.dunning === "object" ? extra.dunning : {}) as Record<string, unknown>;
  extra.dunning = { ...prev, enabled: body.enabled };
  await db.apiConfig.update({ where: { id: config.id }, data: { extraConfig: JSON.stringify(extra) } });
  return NextResponse.json({ enabled: body.enabled });
}
