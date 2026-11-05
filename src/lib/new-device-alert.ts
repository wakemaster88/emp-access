import { prisma, type tenantClient } from "@/lib/prisma";
import { sendTelegramMessage } from "@/lib/telegram";
import { escapeHtml } from "@/lib/email-templates";
import { findVlanForIp } from "@/lib/ip";

type Db = ReturnType<typeof tenantClient>;

export interface SeenDevice {
  ip: string | null;
  hostname: string | null;
  vendor: string | null;
  deviceType: string | null;
}

/** Ab so vielen neuen Geraeten in einem Scan geht eine Sammelnachricht raus. */
const SUMMARY_THRESHOLD = 5;
const SUMMARY_MAX_LINES = 15;

/** Lokal verwaltete MAC (Bit 2 im ersten Oktett): typisch fuer Handys mit privater WLAN-Adresse. */
export function isRandomizedMac(mac: string): boolean {
  const first = parseInt(mac.slice(0, 2), 16);
  return Number.isFinite(first) && (first & 0x02) === 0x02;
}

function describe(
  mac: string,
  d: SeenDevice,
  vlans: Array<{ id: number; vlanId: number; name: string; subnet: string | null }>,
  blockedCount = 0
): string {
  const name = d.hostname || d.vendor || (isRandomizedMac(mac) ? "Private MAC (Handy/Tablet?)" : "Unbekannter Hersteller");
  const vlan = d.ip ? findVlanForIp(d.ip, vlans) : null;
  const parts = [
    d.ip ? `IP ${d.ip}` : null,
    vlan ? `VLAN ${vlan.vlanId} ${vlan.name}` : null,
    d.deviceType ? d.deviceType : null,
    `MAC ${mac}`,
  ].filter(Boolean);
  // Eine private MAC kann ein gesperrtes Handy mit neuer Adresse sein.
  const hint =
    blockedCount > 0 && isRandomizedMac(mac)
      ? "\nPrivate MAC: kann auch ein gesperrtes Handy mit neuer Adresse sein."
      : "";
  return `<b>${escapeHtml(name)}</b>\n${escapeHtml(parts.join(" · "))}${escapeHtml(hint)}`;
}

/**
 * Nach einem Hub-Scan: unbekannte MACs merken und per Telegram melden.
 *
 * - Erster Lauf fuer einen Account (noch keine bekannten Geraete): der
 *   komplette Bestand wird still uebernommen, es geht keine Meldung raus.
 * - Danach meldet jede neue MAC genau einmal (bei vielen auf einmal als
 *   Sammelnachricht). Gesperrt wird nichts.
 *
 * Fehler hier duerfen den Scan-Import nie abbrechen; der Aufrufer faengt ab.
 */
export async function alertNewDevices(
  db: Db,
  accountId: number,
  seen: Map<string, SeenDevice>
): Promise<{ baseline: number; added: number; notified: boolean }> {
  if (seen.size === 0) return { baseline: 0, added: 0, notified: false };
  const macs = [...seen.keys()];

  const knownCount = await db.knownNetworkDevice.count({ where: { accountId } });
  if (knownCount === 0) {
    const res = await db.knownNetworkDevice.createMany({
      data: macs.map((macAddress) => ({ macAddress, accountId })),
      skipDuplicates: true,
    });
    return { baseline: res.count, added: 0, notified: false };
  }

  const known = await db.knownNetworkDevice.findMany({
    where: { accountId, macAddress: { in: macs } },
    select: { macAddress: true },
  });
  const knownSet = new Set(known.map((k) => k.macAddress));
  const fresh = macs.filter((m) => !knownSet.has(m));
  if (fresh.length === 0) return { baseline: 0, added: 0, notified: false };

  const now = new Date();
  // createMany mit skipDuplicates: laufen zwei Scans parallel, meldet nur der
  // erste. Gemeldet wird nur, was dieser Aufruf wirklich angelegt hat.
  const created = await db.knownNetworkDevice.createManyAndReturn({
    data: fresh.map((macAddress) => ({ macAddress, accountId, notifiedAt: now })),
    skipDuplicates: true,
    select: { macAddress: true },
  });
  const added = created.map((c) => c.macAddress);
  if (added.length === 0) return { baseline: 0, added: 0, notified: false };

  const [configs, vlans, blockedCount] = await Promise.all([
    prisma.telegramConfig.findMany({
      where: { accountId, isActive: true, notifyNewDevices: true },
      select: { botToken: true, chatId: true },
    }),
    db.networkVlan.findMany({
      where: { accountId, subnet: { not: null } },
      select: { id: true, vlanId: true, name: true, subnet: true },
    }),
    db.blockedNetworkDevice.count({ where: { accountId } }),
  ]);
  if (configs.length === 0) return { baseline: 0, added: added.length, notified: false };

  let text: string;
  if (added.length < SUMMARY_THRESHOLD) {
    text = added
      .map((mac) => `🆕 Neues Gerät im Netz\n${describe(mac, seen.get(mac)!, vlans, blockedCount)}`)
      .join("\n\n");
  } else {
    const lines = added
      .slice(0, SUMMARY_MAX_LINES)
      .map((mac) => describe(mac, seen.get(mac)!, vlans, blockedCount));
    const more = added.length - lines.length;
    text =
      `🆕 ${added.length} neue Geräte im Netz\n\n` +
      lines.join("\n\n") +
      (more > 0 ? `\n\n… und ${more} weitere` : "");
  }

  let notified = false;
  for (const c of configs) {
    const res = await sendTelegramMessage(c.botToken, c.chatId, text).catch(() => ({ ok: false }));
    notified = notified || res.ok;
  }
  return { baseline: 0, added: added.length, notified };
}
