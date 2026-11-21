/**
 * Geburtstag in der Kunden-App: Gruß und Geschenk auf der Startseite, Push
 * an die Geräte der Person und eine Durchsage, wenn das Geburtstagskind am
 * Start-Drehkreuz scannt. Jedes davon einmal je Person und Jahr
 * (`RiderBirthdayGift`). Regeln ohne Datenbank in `birthday.ts`.
 */
import { prisma, tenantClient } from "./prisma";
import { berlinHour, berlinYmd } from "./berlin-day";
import { createBenefitVoucher, isUniqueViolation } from "./gamification-service";
import { aboStatus } from "./rider-shop";
import { riderAppPath, type RiderView } from "./rider-app";
import { deliverPush, isWebPushConfigured } from "./web-push";
import { inAnnounceHours } from "./rider-announce-rules";
import {
  ageOn,
  birthdayAnnounceText,
  birthdayPushBlock,
  birthdayPushText,
  birthdayTitle,
  fillName,
  isBirthdayOn,
  parseBirthdayZoneIds,
} from "./birthday";
import { queueAnnouncement, renderTtsTrack, resolveTargetZones } from "./audio";

export interface RiderBirthdayView {
  title: string;
  text: string | null;
  age: number;
  voucher: { id: number; label: string; expiresAt: Date | null; redeemed: boolean } | null;
  /** Ohne gültiges Abo gibt es nur den Gruß, obwohl ein Geschenk eingestellt ist. */
  giftNeedsAbo: boolean;
  /** Durchsage am Lift ist eingeschaltet; `on` = die Person hat sie nicht abgeschaltet. */
  announce: { on: boolean } | null;
}

/** Gibt es den Eintrag für Person und Jahr? Sonst anlegen (parallel sicher). */
async function giftRow(accountId: number, profileId: number, year: number) {
  const where = { profileId_year: { profileId, year } };
  const found = await prisma.riderBirthdayGift.findUnique({ where });
  if (found) return found;
  try {
    return await tenantClient(accountId).riderBirthdayGift.create({ data: { accountId, profileId, year } });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    return prisma.riderBirthdayGift.findUniqueOrThrow({ where });
  }
}

/**
 * Geburtstagskarte für die Startseite, nur am Geburtstag selbst. Das
 * Geschenk bekommt jede Person mit gültigem Abo einmal je Jahr, beim ersten
 * Öffnen der App am Geburtstag (wie bei den Feiertagen).
 */
export async function loadRiderBirthday(rider: RiderView, now: Date = new Date()): Promise<RiderBirthdayView | null> {
  const { accountId, profileId } = rider;
  const settings = await prisma.riderBirthday.findUnique({ where: { accountId } });
  if (!settings || (!settings.active && !settings.announceActive)) return null;
  const profile = await prisma.riderProfile.findUnique({
    where: { id: profileId },
    select: { birthDate: true, firstName: true, birthdayAnnounce: true },
  });
  const today = berlinYmd(now);
  if (!profile?.birthDate || !isBirthdayOn(profile.birthDate, today)) return null;
  const year = Number(today.slice(0, 4));
  const firstName = profile.firstName?.trim() || rider.firstName || null;

  const view: RiderBirthdayView = {
    title: birthdayTitle(settings.active ? settings.title : null, firstName),
    text: settings.active && settings.text?.trim() ? fillName(settings.text.trim(), firstName) : null,
    age: ageOn(profile.birthDate, today),
    voucher: null,
    giftNeedsAbo: false,
    announce:
      settings.announceActive && parseBirthdayZoneIds(settings.announceZoneIds).length > 0
        ? { on: profile.birthdayAnnounce }
        : null,
  };
  const label = settings.active ? settings.voucherLabel?.trim() : null;
  if (!label) return view;

  const existing = await prisma.riderBirthdayGift.findUnique({
    where: { profileId_year: { profileId, year } },
    select: { id: true, createdAt: true, giftAt: true, voucherId: true, accountId: true, year: true, profileId: true, pushedAt: true, pushSent: true, announcedAt: true, voucher: { select: { id: true, label: true, expiresAt: true, redeemedAt: true } } },
  });
  if (existing?.voucher) {
    const v = existing.voucher;
    view.voucher = { id: v.id, label: v.label ?? label, expiresAt: v.expiresAt, redeemed: v.redeemedAt != null };
    return view;
  }

  const abo = aboStatus(rider.abo, now);
  const ticket =
    abo.kind === "active" || abo.kind === "unlimited"
      ? await prisma.ticket.findFirst({
          where: { accountId, riderProfileId: profileId, subscriptionId: { not: null } },
          orderBy: { id: "desc" },
          select: { id: true },
        })
      : null;
  if (!ticket) {
    view.giftNeedsAbo = true;
    return view;
  }

  const db = tenantClient(accountId);
  try {
    const row = existing ?? (await giftRow(accountId, profileId, year));
    // Erst den Eintrag beanspruchen: verliert ein paralleler Aufruf, entsteht kein zweiter Gutschein.
    const claimed = await db.riderBirthdayGift.updateMany({
      where: { id: row.id, accountId, giftAt: null },
      data: { giftAt: now },
    });
    if (claimed.count !== 1) return view;
    const voucher = await createBenefitVoucher(db, {
      accountId,
      ticketId: ticket.id,
      label,
      notes: `Geburtstag ${year}`,
      validDays: settings.voucherValidDays,
    }).catch(async (e) => {
      // Ohne Gutschein wieder freigeben, damit es beim nächsten Öffnen klappt.
      await db.riderBirthdayGift.update({ where: { id: row.id }, data: { giftAt: null } }).catch(() => {});
      throw e;
    });
    await db.riderBirthdayGift.update({ where: { id: row.id }, data: { voucherId: voucher.id } });
    view.voucher = { id: voucher.id, label, expiresAt: voucher.expiresAt, redeemed: false };
  } catch (e) {
    console.error("[rider-birthday] Geschenk vergeben fehlgeschlagen:", e);
  }
  return view;
}

/** Person schaltet die Geburtstags-Durchsage am Lift für sich ab oder wieder an. */
export async function setBirthdayAnnounce(profileId: number, on: boolean): Promise<void> {
  await prisma.riderProfile.update({ where: { id: profileId }, data: { birthdayAnnounce: on } });
}

type PushTarget = { id: number; endpoint: string; p256dh: string; auth: string };

/**
 * Push am Geburtstag, einmal je Person und Jahr, tagsüber (9–21 Uhr Berlin).
 * Ein Kind ohne eigenes Gerät: die Erwachsenen seiner Familie bekommen
 * „Heute hat Mia Geburtstag“. Gesendet wird an die eigene App der Person.
 */
export async function runBirthdayPushes(accountId: number, now: Date = new Date()): Promise<number> {
  if (!isWebPushConfigured()) return 0;
  if (!inAnnounceHours(berlinHour(now))) return 0;
  const settings = await prisma.riderBirthday.findUnique({ where: { accountId } });
  if (!settings || birthdayPushBlock(settings) !== null) return 0;
  const today = berlinYmd(now);
  const year = Number(today.slice(0, 4));

  const profiles = await prisma.riderProfile.findMany({
    where: { accountId, birthDate: { not: null } },
    select: { id: true, token: true, firstName: true, birthDate: true, familyId: true, familyAdult: true },
  });
  const born = profiles.filter((p) => isBirthdayOn(p.birthDate, today));
  if (born.length === 0) return 0;
  const done = await prisma.riderBirthdayGift.findMany({
    where: { accountId, year, profileId: { in: born.map((p) => p.id) }, pushedAt: { not: null } },
    select: { profileId: true },
  });
  const sentAlready = new Set(done.map((d) => d.profileId));

  let announced = 0;
  for (const p of born) {
    if (sentAlready.has(p.id)) continue;
    const own = await prisma.riderPushSubscription.findMany({
      where: { accountId, profileId: p.id },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
    // Kind ohne eigenes Gerät: an die Erwachsenen der Familie.
    let targets: { token: string; subs: PushTarget[] }[] = own.length > 0 ? [{ token: p.token, subs: own }] : [];
    let forOther = false;
    if (targets.length === 0 && p.familyId != null && !p.familyAdult) {
      const adults = await prisma.riderProfile.findMany({
        where: { accountId, familyId: p.familyId, familyAdult: true },
        select: { token: true, pushSubscriptions: { select: { id: true, endpoint: true, p256dh: true, auth: true } } },
      });
      targets = adults.filter((a) => a.pushSubscriptions.length > 0).map((a) => ({ token: a.token, subs: a.pushSubscriptions }));
      forOther = true;
    }
    if (targets.length === 0) continue;

    const row = await giftRow(accountId, p.id, year);
    const claimed = await prisma.riderBirthdayGift.updateMany({
      where: { id: row.id, pushedAt: null },
      data: { pushedAt: now },
    });
    if (claimed.count !== 1) continue;
    const text = birthdayPushText(settings, p.firstName, forOther);
    let sent = 0;
    const stale: number[] = [];
    for (const t of targets) {
      const res = await deliverPush(t.subs, { ...text, url: riderAppPath(t.token), tag: `rider-birthday-${p.id}-${year}` });
      sent += res.sent;
      stale.push(...res.staleIds);
    }
    if (stale.length > 0) await prisma.riderPushSubscription.deleteMany({ where: { id: { in: stale } } });
    await prisma.riderBirthdayGift.update({ where: { id: row.id }, data: { pushSent: sent } });
    announced++;
  }
  return announced;
}

/** Konten, für die der Cron Geburtstags-Pushes prüfen muss. */
export async function birthdayPushAccounts(): Promise<number[]> {
  const rows = await prisma.riderBirthday.findMany({ where: { active: true, pushPlanned: true }, select: { accountId: true } });
  return rows.map((r) => r.accountId);
}

/**
 * Scan am Start-Drehkreuz: Hat die Person heute Geburtstag, kommt einmal am
 * Tag eine Durchsage in den eingestellten Zonen (Text über xAI-Sprachausgabe,
 * gleicher Text wird wiederverwendet). Läuft ohne den Scan aufzuhalten.
 */
export async function announceBirthdayOnScan(accountId: number, profileId: number, now: Date = new Date()): Promise<boolean> {
  const settings = await prisma.riderBirthday.findUnique({ where: { accountId } });
  if (!settings?.announceActive) return false;
  const zoneIds = parseBirthdayZoneIds(settings.announceZoneIds);
  if (zoneIds.length === 0) return false;
  const profile = await prisma.riderProfile.findFirst({
    where: { id: profileId, accountId },
    select: { birthDate: true, firstName: true, birthdayAnnounce: true },
  });
  const today = berlinYmd(now);
  if (!profile?.birthdayAnnounce || !isBirthdayOn(profile.birthDate, today)) return false;

  const db = tenantClient(accountId);
  const zones = await resolveTargetZones(db, accountId, zoneIds);
  if (zones.length === 0) return false;
  const year = Number(today.slice(0, 4));
  const row = await giftRow(accountId, profileId, year);
  const claimed = await prisma.riderBirthdayGift.updateMany({
    where: { id: row.id, announcedAt: null },
    data: { announcedAt: now },
  });
  if (claimed.count !== 1) return false;

  const firstName = profile.firstName?.trim() || null;
  const text = birthdayAnnounceText(settings, firstName);
  try {
    const track = await renderTtsTrack(db, accountId, text, settings.announceVoice);
    const announcement = await db.audioAnnouncement.create({
      data: {
        accountId,
        // Im Verlauf ohne Nachnamen: nur, dass es eine Geburtstags-Durchsage war.
        name: settings.announceName && firstName ? `Geburtstag ${firstName}` : "Geburtstag",
        source: "TTS",
        text,
        voice: settings.announceVoice,
        trackId: track.id,
        chime: settings.announceChime,
        repeatCount: 1,
        priority: 0,
        zoneIds: zones.map((z) => z.id),
        isTemplate: false,
      },
    });
    await queueAnnouncement(db, accountId, { ...announcement, track }, zones, "BIRTHDAY");
    return true;
  } catch (e) {
    // Ohne Durchsage wieder freigeben: der nächste Scan heute versucht es erneut.
    await prisma.riderBirthdayGift.update({ where: { id: row.id }, data: { announcedAt: null } }).catch(() => {});
    throw e;
  }
}
