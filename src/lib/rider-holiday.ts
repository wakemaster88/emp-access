import { prisma, tenantClient } from "./prisma";
import { berlinYmd } from "./berlin-day";
import { createBenefitVoucher, isUniqueViolation } from "./gamification-service";
import { currentHoliday, type HolidayShowKind } from "./holidays";
import { aboStatus } from "./rider-shop";
import type { RiderView } from "./rider-app";

export interface RiderHolidayView {
  key: string;
  name: string;
  /** Datum des Feiertags, „YYYY-MM-DD“. */
  ymd: string;
  /** Heute ist der Feiertag selbst (sonst: er steht bevor). */
  isToday: boolean;
  show: HolidayShowKind;
  title: string;
  text: string | null;
  /** VOUCHER: der Gutschein dieser Person, sobald er vergeben ist. */
  voucher: { id: number; label: string; expiresAt: Date | null; redeemed: boolean } | null;
}

/**
 * Der Feiertag für die Startseite der Kunden-App, falls heute einer gezeigt
 * wird. Bei „Gutschein“ bekommt jede Person mit gültigem Abo ihn einmal je
 * Feiertag und Jahr, beim ersten Öffnen der App im Zeitraum. Ohne Abo bleibt
 * es beim Gruß.
 */
export async function loadRiderHoliday(rider: RiderView, now: Date = new Date()): Promise<RiderHolidayView | null> {
  const { accountId, profileId } = rider;
  const settings = await prisma.riderHoliday.findMany({ where: { accountId, active: true } });
  if (settings.length === 0) return null;
  const today = berlinYmd(now);
  const hit = currentHoliday(settings, today);
  if (!hit) return null;
  const s = hit.setting;

  const view: RiderHolidayView = {
    key: s.key,
    name: hit.def.name,
    ymd: hit.ymd,
    isToday: hit.ymd === today,
    show: s.show,
    title: s.title?.trim() || hit.def.greeting,
    text: s.text?.trim() || null,
    voucher: null,
  };
  if (s.show !== "VOUCHER" || !s.voucherLabel) return view;

  const existing = await prisma.riderHolidayGift.findUnique({
    where: { holidayId_year_profileId: { holidayId: s.id, year: hit.year, profileId } },
    select: { voucher: { select: { id: true, label: true, expiresAt: true, redeemedAt: true } } },
  });
  if (existing) {
    const v = existing.voucher;
    view.voucher = v ? { id: v.id, label: v.label ?? s.voucherLabel, expiresAt: v.expiresAt, redeemed: v.redeemedAt != null } : null;
    return view;
  }

  // Nur mit gültigem Abo; das Personal sieht in der Verwaltung, wem er gehört.
  const abo = aboStatus(rider.abo, now);
  if (abo.kind !== "active" && abo.kind !== "unlimited") return view;
  const ticket = await prisma.ticket.findFirst({
    where: { accountId, riderProfileId: profileId, subscriptionId: { not: null } },
    orderBy: { id: "desc" },
    select: { id: true },
  });
  if (!ticket) return view;

  const db = tenantClient(accountId);
  try {
    // Erst der Eintrag (eindeutig je Person, Feiertag und Jahr): verliert ein
    // paralleler Aufruf das Rennen, entsteht kein zweiter Gutschein.
    const gift = await db.riderHolidayGift.create({
      data: { holidayId: s.id, year: hit.year, profileId, accountId },
    });
    const voucher = await createBenefitVoucher(db, {
      accountId,
      ticketId: ticket.id,
      label: s.voucherLabel,
      notes: `Feiertag ${hit.def.name} ${hit.year}`,
      validDays: s.voucherValidDays,
    }).catch(async (e) => {
      // Ohne Gutschein den Eintrag wieder freigeben, damit es beim nächsten Öffnen klappt.
      await db.riderHolidayGift.delete({ where: { id: gift.id } }).catch(() => {});
      throw e;
    });
    await db.riderHolidayGift.update({ where: { id: gift.id }, data: { voucherId: voucher.id } });
    view.voucher = { id: voucher.id, label: s.voucherLabel, expiresAt: voucher.expiresAt, redeemed: false };
  } catch (e) {
    if (!isUniqueViolation(e)) console.error("[rider-holiday] Gutschein vergeben fehlgeschlagen:", e);
  }
  return view;
}
