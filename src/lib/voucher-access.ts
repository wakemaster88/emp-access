import { berlinYmd } from "./berlin-day";
import { BENEFIT_STATE_MESSAGE } from "./gamification";

/**
 * Gemeinsame Prüfung, ob ein Gutschein am Einlass (Handscanner/Scan-Check,
 * Pi-Scan am Drehkreuz, Check-in-Kiosk) als Zutritt eingelöst werden darf.
 *
 * Zutritt gibt nur ein Zutritts-Gutschein (kind ACCESS), der weder
 * deaktiviert noch bereits eingelöst noch abgelaufen ist. Leistungs-Gutscheine
 * (kind BENEFIT, z. B. Freigetränk) geben nie Zutritt.
 *
 * Der Ablauf zählt nach Kalendertag (Europe/Berlin): Mails nennen „Gültig bis
 * <Datum>“ und speichern den Tagesanfang, der Gutschein gilt bis zum Ende
 * dieses Tages.
 *
 * Rein und ohne Datenbankzugriff, damit alle Einlasswege dieselbe Regel
 * verwenden und sie testbar bleibt.
 */

export type VoucherAccessDenyReason = "benefit" | "disabled" | "redeemed" | "expired";

export type VoucherAccessCheck =
  | { ok: true }
  | {
      ok: false;
      reason: VoucherAccessDenyReason;
      /** Satz für das Personal am Einlass. */
      message: string;
      /** Reason-Code für `scan.note`, siehe scan-deny-reason.ts. */
      note: string;
    };

export const VOUCHER_ACCESS_DENY: Record<VoucherAccessDenyReason, { message: string; note: string }> = {
  benefit: { message: "Gutschein gilt nur an der Kasse", note: "voucher_benefit_only" },
  disabled: { message: BENEFIT_STATE_MESSAGE.disabled, note: "voucher_disabled" },
  redeemed: { message: BENEFIT_STATE_MESSAGE.redeemed, note: "voucher_already_redeemed" },
  expired: { message: BENEFIT_STATE_MESSAGE.expired, note: "voucher_expired" },
};

export function checkVoucherAccess(
  voucher: {
    kind: string;
    redeemedAt: Date | null;
    disabledAt: Date | null;
    expiresAt: Date | null;
  },
  now: Date = new Date(),
): VoucherAccessCheck {
  let reason: VoucherAccessDenyReason | null = null;
  if (voucher.kind !== "ACCESS") reason = "benefit";
  // Deaktiviert vor eingelöst: so meldet es auch der Check-in bisher.
  else if (voucher.disabledAt) reason = "disabled";
  else if (voucher.redeemedAt) reason = "redeemed";
  else if (voucher.expiresAt && berlinYmd(now) > berlinYmd(voucher.expiresAt)) reason = "expired";
  if (!reason) return { ok: true };
  return { ok: false, reason, ...VOUCHER_ACCESS_DENY[reason] };
}
