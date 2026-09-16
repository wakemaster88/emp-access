import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";

/**
 * GET (Hub, Token-Auth): Soundweb-Prozessoren samt Reglern, die der Hub
 * verbinden und abonnieren soll. Nur aktive Geräte – ein deaktiviertes
 * bleibt in der Cloud stehen, der Hub baut die Verbindung aber ab.
 */
export async function GET(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const { db, account } = auth;

  const devices = await db.soundwebDevice.findMany({
    where: { accountId: account.id, isActive: true },
    select: {
      id: true,
      name: true,
      host: true,
      port: true,
      node: true,
      controls: {
        select: {
          id: true,
          name: true,
          kind: true,
          node: true,
          virtualDevice: true,
          objectId: true,
          stateVariable: true,
          presetId: true,
        },
        orderBy: { id: "asc" },
      },
    },
    orderBy: { id: "asc" },
  });
  return NextResponse.json({ devices });
}
