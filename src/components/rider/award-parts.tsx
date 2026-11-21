import Link from "next/link";
import { awardRemainingText } from "@/lib/awards";
import { TIER_LABEL, type GamiTier } from "@/lib/gamification";
import type { RiderAward } from "@/lib/rider-app";
import { AwardBadge } from "./award-badge";

/** Kleine Bausteine rund um die Awards der Kunden-App (Seltenheit, Gutschein-Zeile, Symbole). */

export function GiftIcon({ size = 14 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5" />
    </svg>
  );
}

export function CheckIcon({ size = 11 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12.5 9.5 18 20 6.5" />
    </svg>
  );
}

export function LockIcon({ size = 14 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

/** Seltenheit als farbiges Wort: Bronze, Silver, Gold oder Legendary (Regenbogen). */
export function TierTag({ tier, inline }: { tier: GamiTier; inline?: boolean }) {
  return <span className={`rd-aw-tier rd-aw-t-${tier.toLowerCase()}${inline ? " rd-aw-tier-in" : ""}`}>{TIER_LABEL[tier]}</span>;
}

/**
 * Zeile unter einer Kachel: gelb = Gutschein wartet, Haken = eingelöst,
 * grau = gibt es beim Freischalten.
 */
export function RewardLine({ award }: { award: Pick<RiderAward, "unlocked" | "voucher" | "voucherShort"> }) {
  if (!award.voucherShort) return null;
  const state = !award.unlocked ? "lk" : award.voucher?.state === "open" ? "open" : award.voucher?.state === "redeemed" ? "done" : "lk";
  return (
    <span className={`rd-aw-rwl rd-aw-rwl-${state}`}>
      {state === "done" ? <CheckIcon /> : <GiftIcon size={11} />}
      <span>{award.voucherShort}</span>
    </span>
  );
}

/** Karte „Nächster Award“: das Abzeichen noch blass, dazu was fehlt und was es dafür gibt. */
export function NextAwardCard({ award, href }: { award: RiderAward; href: string }) {
  return (
    <Link href={href} prefetch={false} className="rd-card rd-aw-next">
      <span className="rd-aw-tease"><AwardBadge award={award} size={92} /></span>
      <span className="rd-aw-next-t">
        <span className="rd-label">Nächster Award · <TierTag tier={award.tier} inline /></span>
        <span className="rd-display rd-h3">{award.name}</span>
        <span className="rd-muted" style={{ fontSize: 13 }}>
          {awardRemainingText(award)}
          {award.voucherLabel ? ` Dafür gibt es: ${award.voucherLabel}.` : ""}
          {award.skillLabel ? ` Dazu der Skill: ${award.skillLabel}.` : ""}
        </span>
        <span className="rd-aw-bar"><i style={{ width: `${Math.min(100, (award.value / award.threshold) * 100)}%` }} /></span>
        <span className="rd-aw-next-n">{award.value.toLocaleString("de-DE")} / {award.threshold.toLocaleString("de-DE")}</span>
      </span>
    </Link>
  );
}
