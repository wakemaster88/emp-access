import { NextResponse } from "next/server";
import { getSessionWithDb } from "@/lib/api-auth";
import {
  nukiListSmartlocksDetailed,
  nukiGetAccount,
  nukiUpsertWebhook,
  NUKI_DEVICE_TYPE_LABEL,
} from "@/lib/nuki";

/**
 * POST /api/integrations/nuki
 *
 * Synchronisiert alle Smart Locks aus der Nuki Web API in unsere Device-
 * Tabelle (Typ `NUKI_SMARTLOCK`). Identitaet erfolgt ueber `nukiSmartlockId`
 * pro Account – damit bleiben Resource-Verknuepfungen (accessIn/accessOut),
 * Name und Kategorie ueber mehrere Syncs hinweg stabil.
 *
 * Zusatz: registriert (sofern moeglich) einen Webhook bei Nuki, damit
 * Lock-/Unlock-Events live in EMP als Scans landen.
 */
export async function POST() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;

  const { db, accountId } = session;

  const config = await db.apiConfig.findFirst({
    where: { accountId: accountId!, provider: "NUKI" },
  });
  if (!config) {
    return NextResponse.json(
      { error: "Nuki not configured" },
      { status: 404 },
    );
  }

  // Account-Info parallel holen, damit wir bei "0 locks" zeigen koennen
  // welcher Nuki-Account ueberhaupt vom Token getroffen wird.
  const [accountInfo, lockResult] = await Promise.all([
    nukiGetAccount(config.token),
    nukiListSmartlocksDetailed(config.token),
  ]);

  if (!lockResult.ok) {
    await db.apiConfig.update({
      where: { id: config.id },
      data: { lastUpdate: new Date() },
    });
    const hint =
      lockResult.status === 401 || lockResult.status === 403
        ? "Token ist ungueltig oder hat keine Berechtigung. Bitte in Nuki Web → API neuen Token erzeugen und hier einfuegen."
        : lockResult.status === 0
          ? "Nuki API nicht erreichbar (Timeout / Netzwerkfehler)."
          : `Nuki API antwortete mit Status ${lockResult.status}.`;
    return NextResponse.json(
      {
        error: `Nuki-Abruf fehlgeschlagen: ${lockResult.error ?? hint}`,
        status: lockResult.status,
        account: accountInfo.account,
      },
      { status: 502 },
    );
  }

  const smartlocks = lockResult.locks;
  if (smartlocks.length === 0) {
    await db.apiConfig.update({
      where: { id: config.id },
      data: { lastUpdate: new Date() },
    });
    const accountSuffix = accountInfo.account?.email
      ? ` (Token-Account: ${accountInfo.account.email})`
      : accountInfo.account?.accountId != null
        ? ` (Token-Account #${accountInfo.account.accountId})`
        : "";
    return NextResponse.json({
      created: 0,
      updated: 0,
      total: 0,
      webhookRegistered: false,
      account: accountInfo.account,
      message:
        `Nuki API erreichbar, liefert aber 0 Smart Locks${accountSuffix}. ` +
        `Pruefe: (1) Lock steht im richtigen Nuki-Account, (2) in der Nuki-App ` +
        `"Server-Funktionalitaet" + "Lock-State abfragen" aktiviert.`,
    });
  }

  let created = 0;
  let updated = 0;
  const importedNames: string[] = [];

  for (const lock of smartlocks) {
    if (lock.smartlockId == null) continue;
    const nukiSmartlockId = String(lock.smartlockId);
    const typeLabel = lock.type != null ? NUKI_DEVICE_TYPE_LABEL[lock.type] ?? "Smart Lock" : "Smart Lock";
    const name = lock.name?.trim() || `Nuki ${typeLabel} ${nukiSmartlockId}`;
    importedNames.push(name);

    const existing = await db.device.findFirst({
      where: { accountId: accountId!, nukiSmartlockId },
    });

    if (existing) {
      await db.device.update({
        where: { id: existing.id },
        data: {
          name: existing.name === name ? existing.name : existing.name,
          firmware:
            lock.firmwareVersion != null ? String(lock.firmwareVersion) : existing.firmware,
          systemInfo: {
            nukiType: lock.type ?? null,
            nukiTypeLabel: typeLabel,
            state: lock.state ?? null,
            serverState: lock.serverState ?? null,
            batteryCharge: lock.state?.batteryCharge ?? null,
            batteryCritical: lock.state?.batteryCritical ?? null,
            keypadBatteryCritical: lock.state?.keypadBatteryCritical ?? null,
            virtualDevice: lock.virtualDevice ?? null,
            syncedAt: new Date().toISOString(),
          },
          lastUpdate: new Date(),
        },
      });
      updated++;
    } else {
      await db.device.create({
        data: {
          name,
          type: "NUKI_SMARTLOCK",
          category: "TUER",
          nukiSmartlockId,
          firmware: lock.firmwareVersion != null ? String(lock.firmwareVersion) : null,
          isActive: true,
          systemInfo: {
            nukiType: lock.type ?? null,
            nukiTypeLabel: typeLabel,
            state: lock.state ?? null,
            serverState: lock.serverState ?? null,
            batteryCharge: lock.state?.batteryCharge ?? null,
            batteryCritical: lock.state?.batteryCritical ?? null,
            keypadBatteryCritical: lock.state?.keypadBatteryCritical ?? null,
            virtualDevice: lock.virtualDevice ?? null,
            importedAt: new Date().toISOString(),
          },
          lastUpdate: new Date(),
          accountId: accountId!,
        },
      });
      created++;
    }
  }

  let webhookRegistered = false;
  let webhookError: string | undefined;
  try {
    const baseUrl = process.env.AUTH_URL || process.env.NEXTAUTH_URL || "";
    const extra = config.extraConfig ? (JSON.parse(config.extraConfig) as Record<string, unknown>) : {};
    const secret = typeof extra.webhookSecret === "string" ? extra.webhookSecret : null;
    if (baseUrl && secret && /^https:\/\//i.test(baseUrl)) {
      const webhookUrl = `${baseUrl.replace(/\/$/, "")}/api/integrations/nuki/webhook?secret=${secret}`;
      const wh = await nukiUpsertWebhook(config.token, webhookUrl);
      webhookRegistered = wh.ok;
      webhookError = wh.error;
      if (wh.ok && wh.notificationId) {
        const nextExtra = { ...extra, notificationId: wh.notificationId, webhookUrl };
        await db.apiConfig.update({
          where: { id: config.id },
          data: { extraConfig: JSON.stringify(nextExtra) },
        });
      }
    }
  } catch (e) {
    webhookError = e instanceof Error ? e.message : "Webhook registration failed";
  }

  await db.apiConfig.update({
    where: { id: config.id },
    data: { lastUpdate: new Date() },
  });

  return NextResponse.json({
    created,
    updated,
    total: smartlocks.length,
    webhookRegistered,
    webhookError,
    devices: importedNames,
    account: accountInfo.account,
  });
}

/** GET zeigt aktuellen Sync-Status / Devices an (zum Debuggen). */
export async function GET() {
  const session = await getSessionWithDb();
  if ("error" in session) return session.error;
  const { db, accountId } = session;

  const [config, devices] = await Promise.all([
    db.apiConfig.findFirst({ where: { accountId: accountId!, provider: "NUKI" } }),
    db.device.findMany({
      where: { accountId: accountId!, type: "NUKI_SMARTLOCK" },
      select: {
        id: true,
        name: true,
        nukiSmartlockId: true,
        firmware: true,
        lastUpdate: true,
        isActive: true,
        systemInfo: true,
      },
      orderBy: { name: "asc" },
    }),
  ]);

  return NextResponse.json({
    configured: !!config,
    lastUpdate: config?.lastUpdate ?? null,
    devices,
  });
}
