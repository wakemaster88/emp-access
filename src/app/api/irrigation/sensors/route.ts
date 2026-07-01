import { NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { gardenaListSensors, type GardenaSensor } from "@/lib/gardena";

/**
 * Listet alle GARDENA Bodenfeuchte-Sensoren ueber alle GARDENA-Verbindungen
 * des Accounts (fuer die Sensor-Auswahl im Zeitplan-Dialog und die
 * Feuchte-Anzeige auf der Bewaesserungs-Seite).
 */
export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;
  const configs = await db.apiConfig.findMany({
    where: { accountId: accountId!, provider: "GARDENA" },
    select: { id: true, name: true, token: true, extraConfig: true },
  });

  const sensors: Array<GardenaSensor & { configId: number; connectionName: string | null }> = [];
  await Promise.all(
    configs
      .filter((c) => c.token && c.extraConfig)
      .map(async (c) => {
        const res = await gardenaListSensors(c.token!, c.extraConfig!);
        if (!res.ok) return;
        for (const s of res.sensors) {
          sensors.push({ ...s, configId: c.id, connectionName: c.name ?? null });
        }
      }),
  );

  sensors.sort((a, b) => a.name.localeCompare(b.name, "de"));
  return NextResponse.json(sensors);
}
