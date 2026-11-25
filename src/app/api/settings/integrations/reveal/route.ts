import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionWithDb } from "@/lib/api-auth";

/**
 * Ein gespeichertes Geheimnis einer Schnittstelle im Klartext, nur für Admins
 * und nur auf ausdrücklichen Klick („Anzeigen“). Gebraucht für Werte, die der
 * Admin beim Partner-System eintragen muss (Webhook-Geheimnis bzw. die URL
 * mit `?secret=`). GET /api/settings/integrations liefert sie nur maskiert.
 */
const schema = z.object({
  provider: z.enum(["ANNY", "WAKESYS", "BINARYTEC", "EMP_CONTROL", "NUKI", "LOQED"]),
  field: z.enum(["webhookSecret"]),
});

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(req: NextRequest) {
  const session = await getSessionWithDb({ requireAdmin: true });
  if ("error" in session) return session.error;
  if (session.accountId == null) {
    return NextResponse.json({ error: "Kein Mandant zugeordnet" }, { status: 403, headers: NO_STORE });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "provider oder field fehlt" }, { status: 400, headers: NO_STORE });
  }

  const config = await session.db.apiConfig.findFirst({
    where: { accountId: session.accountId, provider: parsed.data.provider },
    select: { extraConfig: true },
  });
  let value: unknown;
  try {
    value = config?.extraConfig ? (JSON.parse(config.extraConfig) as Record<string, unknown>)[parsed.data.field] : undefined;
  } catch { /* unlesbares JSON: nichts gespeichert */ }

  if (typeof value !== "string" || !value) {
    return NextResponse.json({ error: "Nicht gespeichert" }, { status: 404, headers: NO_STORE });
  }
  return NextResponse.json({ value }, { headers: NO_STORE });
}
