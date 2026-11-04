import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";

/**
 * POST (Hub, Token-Auth): Lampen und Gruppen der gekoppelten Hue Bridges.
 *
 * Was noch nicht als Geraet existiert, wird ohne Raum angelegt. So taucht
 * die Hue-Beleuchtung in der Cloud auf und laesst sich dort im Raum-Dialog
 * zuordnen, ohne dass jemand am Hub-Dashboard klicken muss. Vorhandene
 * Geraete behalten Namen und Raum; nur `lastUpdate` zeigt, dass die Bridge
 * sie noch kennt.
 *
 * Body: { bridges: [{ bridgeId, items: [{ lightId: "3" | "g2", name }] }] }
 */
const MAX_ITEMS = 300;

export async function POST(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const { db, account } = auth;

  const body = await request.json().catch(() => ({}));
  const bridges: unknown[] = Array.isArray(body.bridges) ? body.bridges : [];
  const items: { bridgeId: string; lightId: string; name: string }[] = [];
  for (const b of bridges) {
    const bridge = b as { bridgeId?: unknown; items?: unknown };
    const bridgeId = String(bridge.bridgeId ?? "").trim().toLowerCase();
    if (!/^[0-9a-f]{6,32}$/.test(bridgeId) || !Array.isArray(bridge.items)) continue;
    for (const raw of bridge.items) {
      const it = raw as { lightId?: unknown; name?: unknown };
      const lightId = String(it.lightId ?? "").trim();
      if (!/^g?\d{1,4}$/.test(lightId)) continue;
      const name =
        typeof it.name === "string" && it.name.trim()
          ? it.name.trim().slice(0, 120)
          : lightId.startsWith("g")
            ? `Hue Gruppe ${lightId.slice(1)}`
            : `Hue Lampe ${lightId}`;
      items.push({ bridgeId, lightId, name });
      if (items.length >= MAX_ITEMS) break;
    }
  }
  if (items.length === 0) return NextResponse.json({ ok: true, created: 0, seen: 0 });

  const existing = await db.device.findMany({
    where: { accountId: account.id, type: "HUE_LIGHT", hueBridgeId: { in: [...new Set(items.map((i) => i.bridgeId))] } },
    select: { id: true, hueBridgeId: true, hueLightId: true },
  });
  const known = new Map(existing.map((d) => [`${d.hueBridgeId}:${d.hueLightId}`, d.id]));
  const now = new Date();

  const fresh = items.filter((i) => !known.has(`${i.bridgeId}:${i.lightId}`));
  if (fresh.length) {
    await db.device.createMany({
      data: fresh.map((i) => ({
        accountId: account.id,
        name: i.name,
        type: "HUE_LIGHT" as const,
        category: "BELEUCHTUNG" as const,
        hueBridgeId: i.bridgeId,
        hueLightId: i.lightId,
        lastUpdate: now,
      })),
    });
  }
  const seenIds = items.map((i) => known.get(`${i.bridgeId}:${i.lightId}`)).filter((id): id is number => id != null);
  if (seenIds.length) {
    await db.device.updateMany({ where: { id: { in: seenIds } }, data: { lastUpdate: now } });
  }
  return NextResponse.json({ ok: true, created: fresh.length, seen: seenIds.length });
}
