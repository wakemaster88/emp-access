import { prisma, type tenantClient } from "@/lib/prisma";
import { sendTelegramMessage } from "@/lib/telegram";
import { formatBlockedAlert, shouldNotifyBlocked, type BlockedHit } from "@/lib/blocked-devices-format";

type Db = ReturnType<typeof tenantClient>;

/**
 * Nach einem Hub-Scan: gesperrte MACs, die trotzdem gesehen wurden, merken und
 * (gedrosselt) per Telegram melden. Sperrt selbst nichts.
 * Fehler duerfen den Scan-Import nie abbrechen; der Aufrufer faengt ab.
 */
export async function alertBlockedDevices(
  db: Db,
  accountId: number,
  seen: Map<string, { ip: string | null }>
): Promise<{ seen: number; notified: boolean }> {
  if (seen.size === 0) return { seen: 0, notified: false };
  const blocked = await db.blockedNetworkDevice.findMany({
    where: { accountId, macAddress: { in: [...seen.keys()] } },
  });
  if (blocked.length === 0) return { seen: 0, notified: false };

  const now = new Date();
  const toNotify: BlockedHit[] = [];
  for (const b of blocked) {
    const ip = seen.get(b.macAddress)?.ip ?? null;
    const notify = shouldNotifyBlocked(b.notifiedAt, now);
    await db.blockedNetworkDevice.update({
      where: { id: b.id },
      data: { lastSeenAt: now, lastSeenIp: ip, ...(notify ? { notifiedAt: now } : {}) },
    });
    if (notify) toNotify.push({ name: b.name, macAddress: b.macAddress, ip, enforced: !!b.enforcedAt });
  }
  if (toNotify.length === 0) return { seen: blocked.length, notified: false };

  const configs = await prisma.telegramConfig.findMany({
    where: { accountId, isActive: true },
    select: { botToken: true, chatId: true },
  });
  const text = formatBlockedAlert(toNotify);
  let notified = false;
  for (const c of configs) {
    const res = await sendTelegramMessage(c.botToken, c.chatId, text).catch(() => ({ ok: false }));
    notified = notified || res.ok;
  }
  return { seen: blocked.length, notified };
}
