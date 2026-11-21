import type { TenantDb } from "@/lib/prisma";
import { benefitVoucherState, type BenefitVoucherState } from "@/lib/gamification";
import { redeemBenefitVoucher } from "@/lib/gamification-service";
import { buildScanCodeVariants } from "@/lib/scan-code-variants";
import { berlinDayStart } from "@/lib/berlin-day";

/**
 * Gutschein-Monitor (Monitor-Typ "VOUCHER", Seite `/gutscheine/[token]`):
 * Das Personal an der Kasse scannt den QR-Code eines Gutscheins aus der
 * Kunden-App, sieht Leistung, Fahrer und Gültigkeit und löst ihn mit einer
 * Taste ein. Prüfen und Einlösen sind getrennt, damit ein Scan „nur zum
 * Nachsehen“ nichts entwertet.
 */
export const VOUCHER_MONITOR_TYPE = "VOUCHER";

/** `redeemedVia` für Einlösungen am Gutschein-Monitor. */
export const VOUCHER_MONITOR_VIA = "KASSE" as const;

export type VoucherCheck =
  | { found: false; message: string }
  | {
      found: true;
      /** Zutritts-Gutscheine (GS-…) gehören an den Check-in, nicht hierher. */
      kind: "BENEFIT" | "ACCESS";
      state: BenefitVoucherState;
      code: string;
      label: string;
      owner: string | null;
      source: string | null;
      expiresAt: string | null;
      redeemedAt: string | null;
      redeemedVia: string | null;
      message: string;
    };

export interface VoucherRedemption {
  id: number;
  code: string;
  label: string;
  owner: string | null;
  redeemedAt: string;
  redeemedVia: string | null;
}

function personLabel(t: { name: string; firstName: string | null; lastName: string | null }): string {
  const full = [t.firstName, t.lastName].filter(Boolean).join(" ").trim();
  return full || t.name;
}

async function findVoucher(db: TenantDb, accountId: number, code: string) {
  // Wie am Check-in: Handscanner mit deutschem Layout liefern "GSß…" statt "GS-…".
  const variants = buildScanCodeVariants(code);
  if (variants.length === 0) return null;
  return db.voucher.findFirst({ where: { accountId, OR: variants.map((c) => ({ code: c })) } });
}

async function ownerName(db: TenantDb, accountId: number, ticketId: number | null): Promise<string | null> {
  if (ticketId == null) return null;
  const t = await db.ticket.findFirst({
    where: { id: ticketId, accountId },
    select: { name: true, firstName: true, lastName: true },
  });
  return t ? personLabel(t) : null;
}

const STATE_TEXT: Record<BenefitVoucherState, string> = {
  open: "Gültig",
  redeemed: "Bereits eingelöst",
  expired: "Abgelaufen",
  disabled: "Deaktiviert",
};

/** Gutschein nachschlagen, ohne etwas zu ändern. */
export async function checkVoucher(db: TenantDb, accountId: number, code: string, now = new Date()): Promise<VoucherCheck> {
  const voucher = await findVoucher(db, accountId, code);
  if (!voucher) return { found: false, message: "Gutschein nicht gefunden" };
  const state = benefitVoucherState(voucher, now);
  const isBenefit = voucher.kind === "BENEFIT";
  return {
    found: true,
    kind: isBenefit ? "BENEFIT" : "ACCESS",
    state,
    code: voucher.code,
    label: isBenefit ? voucher.label ?? "Gutschein" : voucher.ticketTypeName ?? "Zutritts-Gutschein",
    owner: await ownerName(db, accountId, voucher.ownerTicketId),
    source: voucher.notes,
    expiresAt: voucher.expiresAt?.toISOString() ?? null,
    redeemedAt: voucher.redeemedAt?.toISOString() ?? null,
    redeemedVia: voucher.redeemedVia,
    message: isBenefit ? STATE_TEXT[state] : "Zutritts-Gutschein: bitte am Check-in einlösen",
  };
}

/** Gutschein einlösen. Nur Leistungs-Gutscheine; atomar über `redeemBenefitVoucher`. */
export async function redeemAtMonitor(
  db: TenantDb,
  accountId: number,
  code: string,
): Promise<{ ok: true; check: VoucherCheck } | { ok: false; message: string; check?: VoucherCheck }> {
  const voucher = await findVoucher(db, accountId, code);
  if (!voucher) return { ok: false, message: "Gutschein nicht gefunden" };
  if (voucher.kind !== "BENEFIT") {
    return { ok: false, message: "Das ist ein Zutritts-Gutschein. Er wird am Check-in eingelöst." };
  }
  const result = await redeemBenefitVoucher(db, accountId, voucher, VOUCHER_MONITOR_VIA);
  const check = await checkVoucher(db, accountId, voucher.code);
  return result.ok ? { ok: true, check } : { ok: false, message: result.message, check };
}

/** Heute (Berlin) eingelöste Leistungs-Gutscheine, neueste zuerst. */
export async function todaysRedemptions(db: TenantDb, accountId: number, now = new Date()): Promise<VoucherRedemption[]> {
  const from = berlinDayStart(now);
  const rows = await db.voucher.findMany({
    where: { accountId, kind: "BENEFIT", redeemedAt: { gte: from } },
    orderBy: { redeemedAt: "desc" },
    take: 50,
    select: { id: true, code: true, label: true, ownerTicketId: true, redeemedAt: true, redeemedVia: true },
  });
  const ownerIds = [...new Set(rows.map((r) => r.ownerTicketId).filter((id): id is number => id != null))];
  const owners = ownerIds.length
    ? await db.ticket.findMany({
        where: { accountId, id: { in: ownerIds } },
        select: { id: true, name: true, firstName: true, lastName: true },
      })
    : [];
  const byId = new Map(owners.map((t) => [t.id, personLabel(t)]));
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    label: r.label ?? "Gutschein",
    owner: r.ownerTicketId != null ? byId.get(r.ownerTicketId) ?? null : null,
    redeemedAt: (r.redeemedAt as Date).toISOString(),
    redeemedVia: r.redeemedVia,
  }));
}
