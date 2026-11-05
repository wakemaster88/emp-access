import { NextRequest, NextResponse } from "next/server";
import { validateApiToken } from "@/lib/api-auth";
import { berlinDayStart } from "@/lib/berlin-day";
import { summarizeAreaRates } from "@/lib/turnstile-rate";

export const dynamic = "force-dynamic";

/**
 * GET (Hub, Token-Auth): Zutritte je Bereich mit Drehkreuz fuer die
 * Belegungsschaetzung des Hub-Assistenten. Liefert nur Zaehler, keine
 * Tickets oder Namen.
 *
 * 200 { at, areas: [{ id, name, personLimit, devices, in15, in60, inToday,
 *       out15, out60, outToday, denied15, inside, lastScanAt }] }
 */
export async function GET(request: NextRequest) {
  const auth = await validateApiToken(request);
  if ("error" in auth) return auth.error;
  const { db, account } = auth;

  const now = new Date();
  const dayStart = berlinDayStart(now);
  const devices = await db.device.findMany({
    where: {
      accountId: account.id,
      category: "DREHKREUZ",
      OR: [{ accessIn: { not: null } }, { accessOut: { not: null } }],
    },
    select: { id: true, accessIn: true, accessOut: true },
  });
  const areaIds = [...new Set(devices.flatMap((d) => [d.accessIn, d.accessOut].filter((x): x is number => x != null)))];
  const [areas, scans] = await Promise.all([
    areaIds.length
      ? db.accessArea.findMany({
          where: { accountId: account.id, id: { in: areaIds } },
          select: { id: true, name: true, personLimit: true },
        })
      : Promise.resolve([]),
    devices.length
      ? db.scan.findMany({
          where: { accountId: account.id, deviceId: { in: devices.map((d) => d.id) }, scanTime: { gte: dayStart } },
          select: { deviceId: true, scanTime: true, result: true },
        })
      : Promise.resolve([]),
  ]);

  return NextResponse.json({
    at: now.toISOString(),
    areas: summarizeAreaRates(areas, devices, scans, now, dayStart),
  });
}
