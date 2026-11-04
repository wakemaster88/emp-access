import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { validateApiToken } from "@/lib/api-auth";
import { sanitizeMowerMap, sanitizeMowerState } from "@/lib/mower";

/**
 * POST (Hub, Token-Auth): Zustand und Karte der Mammotion-Maeher.
 *
 * Der Hub meldet bei jeder Aenderung (und sonst alle paar Minuten), was sein
 * Maeher-Dienst ueber die Maeher weiss. Unbekannte Maeher werden als Geraet
 * ohne Raum angelegt und lassen sich im Raum-Dialog zuordnen; vorhandene
 * behalten Namen und Raum. Die Karte kommt nur mit, wenn sie sich geaendert
 * hat – fehlt sie, bleibt die gespeicherte.
 *
 * Body: { mowers: [{ name: "Luba-VA6C39PZ", state: {...}, map?: {...} }] }
 */
const NAME_RE = /^[\w.-]{3,64}$/;
const MAX_MOWERS = 20;

export async function POST(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const { db, account } = auth;

  const body = await request.json().catch(() => ({}));
  const list: unknown[] = Array.isArray(body.mowers) ? body.mowers.slice(0, MAX_MOWERS) : [];
  const now = new Date();
  const items = list.flatMap((raw) => {
    const m = raw as { name?: unknown; state?: unknown; map?: unknown };
    const name = typeof m.name === "string" ? m.name.trim() : "";
    if (!NAME_RE.test(name)) return [];
    const state = sanitizeMowerState(m.state, now);
    if (!state) return [];
    return [{ name, state, map: m.map === undefined ? undefined : sanitizeMowerMap(m.map) }];
  });
  if (items.length === 0) return NextResponse.json({ ok: true, created: 0, updated: 0 });

  const existing = await db.device.findMany({
    where: { accountId: account.id, type: "MAMMOTION_MOWER", mowerName: { in: items.map((i) => i.name) } },
    select: { id: true, mowerName: true },
  });
  const known = new Map(existing.map((d) => [d.mowerName, d.id]));

  let created = 0;
  for (const item of items) {
    const systemInfo = item.state as unknown as Prisma.InputJsonValue;
    const mapData = item.map === undefined ? {} : { mowerMap: (item.map ?? undefined) as Prisma.InputJsonValue | undefined };
    const id = known.get(item.name);
    if (id != null) {
      await db.device.update({
        where: { id },
        data: { systemInfo, lastUpdate: now, firmware: item.state.firmware, ...mapData },
      });
    } else {
      await db.device.create({
        data: {
          accountId: account.id,
          name: item.state.label || item.state.model || item.name,
          type: "MAMMOTION_MOWER",
          mowerName: item.name,
          systemInfo,
          firmware: item.state.firmware,
          lastUpdate: now,
          ...mapData,
        },
      });
      created++;
    }
  }
  return NextResponse.json({ ok: true, created, updated: items.length - created });
}
