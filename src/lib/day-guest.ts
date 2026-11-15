/**
 * Tagesgäste in der Kunden-App. Ein Tagesticket hat keinen Namen und keine
 * Adresse; der Gast meldet es selbst an (Ticket scannen) oder bekommt an der
 * Kasse einen QR-Code dazu. Erst dann wird für ihn gezählt.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma, tenantClient } from "./prisma";
import { berlinYmd } from "./berlin-day";
import { buildScanCodeVariants } from "./scan-code-variants";
import { awardMilestones, loadGamiConfig, syncDayTicketStat } from "./gamification-service";
import { runChallenges } from "./challenge-service";
import { newRiderToken } from "./rider-app";

function secret(): string {
  return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "";
}

function sign(ticketId: number): string {
  return createHmac("sha256", secret()).update(`day-ticket:${ticketId}`).digest("base64url").slice(0, 32);
}

/** Schlüssel im Kassen-Link `/app/ticket/<schlüssel>`; lässt sich nicht erraten. */
export function ticketClaimKey(ticketId: number): string {
  return `${ticketId}.${sign(ticketId)}`;
}

export function verifyTicketClaimKey(value: string): number | null {
  const m = /^(\d{1,12})\.([A-Za-z0-9_-]{32})$/.exec(value);
  if (!m || !secret()) return null;
  const id = Number(m[1]);
  const a = Buffer.from(m[2]);
  const b = Buffer.from(sign(id));
  return a.length === b.length && timingSafeEqual(a, b) ? id : null;
}

export interface DayTicket {
  id: number;
  accountId: number;
  riderProfileId: number | null;
}

const USABLE = ["VALID", "REDEEMED"] as const;

/**
 * Tagesticket zu einem gescannten oder getippten Code finden. Armbänder und
 * Karten werden wieder ausgegeben, deshalb zählt bei ihnen nur das Ticket von
 * heute; ein QR-Code gilt die ganze Saison. `accountId` grenzt an der Kasse
 * auf das eigene Konto ein.
 */
export async function findDayTicketByCode(code: string, accountId?: number, now: Date = new Date()): Promise<DayTicket | null> {
  const variants = buildScanCodeVariants(code);
  if (variants.length === 0) return null;
  const today = berlinYmd(now);
  const candidates = await prisma.ticket.findMany({
    where: {
      ...(accountId != null ? { accountId } : {}),
      subscriptionId: null,
      serviceId: { not: null },
      status: { in: [...USABLE] },
      OR: variants.flatMap((c) => [{ qrCode: c }, { barcode: c }, { rfidCode: c }]),
    },
    select: {
      id: true, accountId: true, serviceId: true, riderProfileId: true,
      qrCode: true, barcode: true, startDate: true, createdAt: true,
    },
    orderBy: { id: "desc" },
    take: 50,
  });
  for (const t of candidates) {
    const day = berlinYmd(t.startDate ?? t.createdAt);
    const unique = variants.some((c) => c === t.qrCode || c === t.barcode);
    if (unique ? day.slice(0, 4) !== today.slice(0, 4) : day !== today) continue;
    const config = await loadGamiConfig(tenantClient(t.accountId), t.accountId);
    if (config.enabled && config.dayServiceIds.includes(t.serviceId!)) {
      return { id: t.id, accountId: t.accountId, riderProfileId: t.riderProfileId };
    }
  }
  return null;
}

/** Tagesticket per ID laden, wenn es teilnehmen darf (für den Kassen-Link). */
export async function findDayTicketById(ticketId: number): Promise<DayTicket | null> {
  const t = await prisma.ticket.findFirst({
    where: { id: ticketId, subscriptionId: null, serviceId: { not: null }, status: { in: [...USABLE] } },
    select: { id: true, accountId: true, serviceId: true, riderProfileId: true },
  });
  if (!t) return null;
  const config = await loadGamiConfig(tenantClient(t.accountId), t.accountId);
  if (!config.enabled || !config.dayServiceIds.includes(t.serviceId!)) return null;
  return { id: t.id, accountId: t.accountId, riderProfileId: t.riderProfileId };
}

/**
 * Tagesticket einem Profil zuordnen und zählen. Gehört es schon zu einem
 * Profil, bleibt es dort. Sonst kommt es zum angemeldeten Gast
 * (`sessionProfileId`) oder bekommt ein neues Profil. Gibt den Token des
 * Profils zurück, zu dem das Ticket jetzt gehört.
 */
export async function claimDayTicket(ticket: DayTicket, sessionProfileId: number | null): Promise<string | null> {
  const { accountId } = ticket;
  let profileId = ticket.riderProfileId;
  if (profileId == null) {
    const own = sessionProfileId != null
      ? await prisma.riderProfile.findFirst({ where: { id: sessionProfileId, accountId }, select: { id: true } })
      : null;
    profileId = own?.id ?? (await prisma.riderProfile.create({ data: { token: newRiderToken(), accountId }, select: { id: true } })).id;
    // Nur zuordnen, wenn inzwischen niemand schneller war.
    const linked = await prisma.ticket.updateMany({
      where: { id: ticket.id, accountId, riderProfileId: null },
      data: { riderProfileId: profileId, gamificationOptOut: false },
    });
    if (linked.count === 0) {
      if (!own) await prisma.riderProfile.delete({ where: { id: profileId } }).catch(() => null);
      const now = await prisma.ticket.findFirst({ where: { id: ticket.id, accountId }, select: { riderProfileId: true } });
      profileId = now?.riderProfileId ?? null;
      if (profileId == null) return null;
    } else {
      const db = tenantClient(accountId);
      const config = await loadGamiConfig(db, accountId);
      const today = berlinYmd(new Date());
      await syncDayTicketStat(db, accountId, ticket.id);
      await awardMilestones(db, accountId, ticket.id, today, config.startCapPerDay);
      await runChallenges(db, accountId, ticket.id, today, config.startCapPerDay);
    }
  }
  const profile = await prisma.riderProfile.findFirst({ where: { id: profileId, accountId }, select: { token: true } });
  return profile?.token ?? null;
}
