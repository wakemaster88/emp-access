/**
 * Ride Pass und Beach Pass: dieselbe Kunden-App, zwei Pässe.
 *
 * Wer ein Lift-Abo hat (`GamificationConfig.subscriptionIds`), bekommt den
 * Ride Pass und zählt Starts am Lift. Wer nur ein Strandbad-Abo hat
 * (`beachSubscriptionIds`, z. B. „Beach Abo“), bekommt den Beach Pass und
 * zählt Besuchstage am Strandbad-Eingang. Der Beach Pass ist ab Werk aus.
 *
 * Bewusst ohne Datenbank-Import: Client-Komponenten dürfen Namen und Texte
 * von hier verwenden (siehe Fallstrick in docs/projektwissen).
 */

export type PassKind = "RIDE" | "BEACH";
export type PassAudience = PassKind | "ALL";

export const PASS_NAME: Record<PassKind, string> = { RIDE: "Ride Pass", BEACH: "Beach Pass" };
/** Erstes Wort der Logo-Animation („Ride“ / „Beach“). */
export const PASS_WORD: Record<PassKind, string> = { RIDE: "Ride", BEACH: "Beach" };

export const AUDIENCE_LABEL: Record<PassAudience, string> = {
  RIDE: "Ride Pass",
  BEACH: "Beach Pass",
  ALL: "Beide Pässe",
};
export const PASS_AUDIENCES: PassAudience[] = ["RIDE", "BEACH", "ALL"];

export function parseAudience(value: unknown): PassAudience | null {
  return value === "RIDE" || value === "BEACH" || value === "ALL" ? value : null;
}

export interface PassConfig {
  beachEnabled: boolean;
  subscriptionIds: number[];
  beachSubscriptionIds: number[];
}

/** Abos, die nur den Beach Pass geben (ein Lift-Abo geht immer vor). */
export function beachOnlySubscriptionIds(cfg: PassConfig): number[] {
  if (!cfg.beachEnabled) return [];
  return cfg.beachSubscriptionIds.filter((id) => !cfg.subscriptionIds.includes(id));
}

/** Zählt dieses Abo für den Beach Pass? */
export function isBeachSubscription(cfg: PassConfig, subscriptionId: number | null | undefined): boolean {
  return subscriptionId != null && beachOnlySubscriptionIds(cfg).includes(subscriptionId);
}

interface PassTicket {
  subscriptionId: number | null;
  status?: string | null;
  endDate?: Date | null;
}

/**
 * Pass einer Person aus ihren Tickets. Zuerst zählen die gerade gültigen
 * Tickets, ohne gültiges alle: wer ein laufendes Beach Abo und ein altes
 * Ride Abo hat, sieht den Beach Pass. Lift-Abo geht vor, Tagesgäste bleiben
 * beim Ride Pass (bis Strandbad-Tageskarten freigegeben sind).
 */
export function passKindOf(tickets: PassTicket[], cfg: PassConfig, now: Date = new Date()): PassKind {
  if (!cfg.beachEnabled || tickets.length === 0) return "RIDE";
  const valid = tickets.filter(
    (t) => (t.status == null || t.status === "VALID" || t.status === "REDEEMED") && (t.endDate == null || t.endDate >= now),
  );
  const pool = valid.length > 0 ? valid : tickets;
  if (pool.some((t) => t.subscriptionId != null && cfg.subscriptionIds.includes(t.subscriptionId))) return "RIDE";
  if (pool.some((t) => isBeachSubscription(cfg, t.subscriptionId))) return "BEACH";
  return "RIDE";
}

/** Zielgruppen, die eine Person mit diesem Pass sieht. */
export function audiencesFor(kind: PassKind): PassAudience[] {
  return [kind, "ALL"];
}

export function audienceMatches(audience: string | null | undefined, kind: PassKind): boolean {
  return audience === "ALL" || (audience ?? "RIDE") === kind;
}
