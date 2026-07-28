import { NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import { loqedListLocks, type LoqedLock } from "@/lib/loqed";
import { loqedBatteryType } from "@/lib/loqed-constants";

/**
 * POST /api/integrations/loqed
 *
 * Holt alle Schloesser des Kontos und legt sie als Geraet vom Typ
 * `LOQED_SMARTLOCK` ab. Wiedererkannt wird ein Schloss an seiner `loqedLockId`,
 * damit Name, Kategorie und Ticket-Zuordnungen ueber Abgleiche hinweg bleiben.
 *
 * Anders als bei Nuki laesst sich der Webhook nicht von hier aus registrieren –
 * LOQED bietet dafuer keine Schnittstelle, die URL wird auf app.loqed.com
 * eingetragen. Die Antwort nennt sie deshalb.
 */

/** Zustand und Ausstattung des Schlosses, wie sie am Geraet hinterlegt werden. */
function systemInfoFor(lock: LoqedLock, key: "importedAt" | "syncedAt") {
  return {
    boltState: lock.bolt_state ?? null,
    batteryPercentage: lock.battery_percentage ?? null,
    batteryType: loqedBatteryType(lock.battery_type),
    modelName: lock.model_name ?? null,
    supportedLockStates: lock.supported_lock_states ?? null,
    lockDirection: lock.lock_direction ?? null,
    mortiseLockType: lock.mortise_lock_type ?? null,
    guestAccessMode: lock.guest_access_mode ?? null,
    partyMode: lock.party_mode ?? null,
    twistAssist: lock.twist_assist ?? null,
    [key]: new Date().toISOString(),
  };
}

export async function POST() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;

  const config = await db.apiConfig.findFirst({
    where: { accountId: accountId!, provider: "LOQED" },
  });
  if (!config?.token?.trim()) {
    return NextResponse.json({ error: "LOQED ist nicht eingerichtet." }, { status: 404 });
  }

  const result = await loqedListLocks(config.token);
  await db.apiConfig.update({ where: { id: config.id }, data: { lastUpdate: new Date() } });

  if (!result.ok) {
    return NextResponse.json(
      { error: `LOQED-Abruf fehlgeschlagen: ${result.error}`, status: result.status },
      { status: 502 },
    );
  }

  if (result.locks.length === 0) {
    return NextResponse.json({
      created: 0, updated: 0, adopted: 0, total: 0,
      message:
        "LOQED ist erreichbar, das Konto führt aber kein Schloss. " +
        "Bitte prüfen, ob der Token zum richtigen Konto gehört und dort Administratorrechte bestehen.",
    });
  }

  let created = 0;
  let updated = 0;
  const adoptedNames: string[] = [];
  const names: string[] = [];

  for (const lock of result.locks) {
    const name = lock.name?.trim() || `LOQED ${lock.id}`;
    names.push(name);

    const existing = await db.device.findFirst({
      where: { accountId: accountId!, loqedLockId: lock.id },
    });

    if (existing) {
      await db.device.update({
        where: { id: existing.id },
        data: { systemInfo: systemInfoFor(lock, "syncedAt"), lastUpdate: new Date() },
      });
      updated++;
      continue;
    }

    // Steht das Schloss schon als Shelly-Geraet in der Liste, wird dieser
    // Eintrag uebernommen statt ein zweiter angelegt: Die Shelly Cloud kennt
    // dasselbe Schloss unter einer eigenen, laengeren Kennung, die auf die
    // LOQED-ID endet. So bleiben Name, Verlauf und Ticket-Zuordnungen erhalten.
    const shellyTwin = await db.device.findFirst({
      where: { accountId: accountId!, type: "SHELLY", shellyId: { endsWith: lock.id } },
    });

    if (shellyTwin) {
      await db.device.update({
        where: { id: shellyTwin.id },
        data: {
          type: "LOQED_SMARTLOCK",
          loqedLockId: lock.id,
          // Als Sensor gefuehrt war es nur, weil sich das Schloss ueber die
          // Shelly Cloud nicht bedienen liess. Jetzt geht das, also gehoert es
          // wieder zu den Tueren. Andere Kategorien bleiben unangetastet.
          ...(shellyTwin.category === "SENSOR" ? { category: "TUER" as const } : {}),
          systemInfo: systemInfoFor(lock, "syncedAt"),
          lastUpdate: new Date(),
        },
      });
      adoptedNames.push(`${shellyTwin.name} (#${shellyTwin.id})`);
      updated++;
      continue;
    }

    await db.device.create({
      data: {
        name,
        type: "LOQED_SMARTLOCK",
        category: "TUER",
        loqedLockId: lock.id,
        isActive: true,
        systemInfo: systemInfoFor(lock, "importedAt"),
        lastUpdate: new Date(),
        accountId: accountId!,
      },
    });
    created++;
  }

  const extra = (() => {
    try { return config.extraConfig ? JSON.parse(config.extraConfig) as Record<string, unknown> : {}; }
    catch { return {}; }
  })();
  const baseUrl = (process.env.AUTH_URL || process.env.NEXTAUTH_URL || "").replace(/\/$/, "");
  const secret = typeof extra.webhookSecret === "string" ? extra.webhookSecret : null;

  return NextResponse.json({
    created,
    updated,
    adopted: adoptedNames.length,
    total: result.locks.length,
    devices: names,
    ...(adoptedNames.length > 0
      ? { message: `Bestehendes Gerät übernommen: ${adoptedNames.join(", ")} – Verlauf und Zuordnungen bleiben erhalten.` }
      : {}),
    // LOQED registriert den Webhook nicht selbst; die URL muss auf
    // app.loqed.com unter API eingetragen werden.
    webhookUrl: baseUrl && secret ? `${baseUrl}/api/integrations/loqed/webhook?secret=${secret}` : null,
  });
}

/** Zeigt den eingerichteten Zustand und die bekannten Schloesser. */
export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const [config, devices] = await Promise.all([
    db.apiConfig.findFirst({ where: { accountId: accountId!, provider: "LOQED" } }),
    db.device.findMany({
      where: { accountId: accountId!, type: "LOQED_SMARTLOCK" },
      select: {
        id: true, name: true, loqedLockId: true, category: true,
        isActive: true, lastUpdate: true, systemInfo: true,
      },
      orderBy: { name: "asc" },
    }),
  ]);

  return NextResponse.json({
    configured: !!config?.token,
    lastUpdate: config?.lastUpdate ?? null,
    devices,
  });
}
