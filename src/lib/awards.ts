/**
 * Awards der Kunden-App: Darstellung (Reihe, Form, Aufdruck, Texte) und die
 * Vorlage mit den 20 Awards. Reine Logik ohne Datenbank. Ein Award ist ein
 * Meilenstein (`Milestone`) mit Seltenheit; gezählt wird in `gamification.ts`,
 * vergeben in `gamification-service.ts`.
 */
import type { GamiMetric, GamiPeriod, GamiTier } from "./gamification";

/** Reihe, in der ein Award im Trophy Case steht. */
export type AwardCategory = "starts" | "days" | "special" | "loyalty";

export const AWARD_CATEGORIES: AwardCategory[] = ["starts", "days", "special", "loyalty"];

export const CATEGORY_LABEL: Record<AwardCategory, string> = {
  starts: "Starts am Lift",
  days: "Besuchstage",
  special: "Specials",
  loyalty: "Treue",
};

export function awardCategory(metric: GamiMetric): AwardCategory {
  if (metric === "STARTS") return "starts";
  if (metric === "VISIT_DAYS") return "days";
  if (metric === "SEASONS") return "loyalty";
  return "special";
}

/** Form des Abzeichens: Sechseck, Kreis, Stern oder Kranz. */
export type AwardShape = "hex" | "circle" | "star" | "crest";

const SHAPE: Record<AwardCategory, AwardShape> = { starts: "hex", days: "circle", special: "star", loyalty: "crest" };

export function awardShape(metric: GamiMetric): AwardShape {
  return SHAPE[awardCategory(metric)];
}

export type AwardIcon = "sun" | "flame" | "flag" | "snow";

/** Aufdruck in der Mitte: Zahl mit Einheit oder ein Symbol. */
export interface AwardFace {
  big?: string;
  sub?: string;
  icon?: AwardIcon;
  /** Ziffer auf der Flagge (nur beim Symbol "flag"). */
  mark?: string;
}

/** Große Zahlen kurz: 1000 wird "1K", 2500 wird "2.5K". */
export function compactNumber(n: number): string {
  if (n < 1000) return String(n);
  const k = Math.round(n / 100) / 10;
  return `${String(k).replace(/\.0$/, "")}K`;
}

const UNIT: Record<GamiMetric, [string, string]> = {
  VISIT_DAYS: ["Besuchstag", "Besuchstage"],
  STARTS: ["Start", "Starts"],
  STREAK_WEEKS: ["Woche in Folge", "Wochen in Folge"],
  EARLY_DAYS: ["früher Tag", "frühe Tage"],
  WEEKENDS: ["Wochenende in Folge", "Wochenenden in Folge"],
  EVENT_DAYS: ["Aktionstag", "Aktionstage"],
  SEASONS: ["Saison", "Saisons"],
};

/** Einheit in Worten, passend zur Zahl: "1 Start", "4 Besuchstage". */
export function awardUnit(metric: GamiMetric, n: number): string {
  return UNIT[metric][n === 1 ? 0 : 1];
}

const FACE_SUB: Partial<Record<GamiMetric, [string, string]>> = {
  STARTS: ["START", "STARTS"],
  VISIT_DAYS: ["TAG", "TAGE"],
  STREAK_WEEKS: ["WOCHE", "WOCHEN"],
  SEASONS: ["SAISON", "SAISONS"],
};

export function awardFace(m: { metric: GamiMetric; threshold: number; key?: string | null }): AwardFace {
  if (m.metric === "EARLY_DAYS") return { icon: "sun" };
  if (m.metric === "WEEKENDS") return { icon: "flame" };
  if (m.metric === "EVENT_DAYS") {
    return m.key === "ice-breaker" ? { icon: "snow" } : { icon: "flag", mark: m.threshold < 10 ? String(m.threshold) : "" };
  }
  const sub = FACE_SUB[m.metric] ?? ["", ""];
  return { big: compactNumber(m.threshold), sub: sub[m.threshold === 1 ? 0 : 1] };
}

const fmt = (n: number) => n.toLocaleString("de-DE");

/** Wofür es den Award gibt, als Satz für die Kunden-App. Eine eigene Beschreibung geht vor. */
export function awardText(m: { metric: GamiMetric; threshold: number; period: GamiPeriod; hint?: string | null }): string {
  if (m.hint?.trim()) return m.hint.trim();
  const n = m.threshold;
  const where = m.period === "MONTH" ? "in einem Monat" : m.period === "SEASON" ? "in einer Saison" : "";
  switch (m.metric) {
    case "STARTS":
      return n === 1 && !where ? "Dein erster Start am Lift." : `${fmt(n)} ${awardUnit("STARTS", n)} ${where || "am Lift"}.`;
    case "VISIT_DAYS":
      return `${fmt(n)} ${awardUnit("VISIT_DAYS", n)} ${where || "insgesamt"}.`;
    case "STREAK_WEEKS":
      return `${fmt(n)} ${n === 1 ? "Woche" : "Wochen"} in Folge am Lift.`;
    case "EARLY_DAYS":
      return `${fmt(n)} ${n === 1 ? "Tag" : "Tage"} mit Start in der ersten Stunde.`;
    case "WEEKENDS":
      return `${fmt(n)} ${n === 1 ? "Wochenende" : "Wochenenden in Folge"} am Lift.`;
    case "EVENT_DAYS":
      return n === 1 ? "Start an einem Aktionstag." : `Start an ${fmt(n)} Aktionstagen.`;
    case "SEASONS":
      return `${fmt(n)} ${awardUnit("SEASONS", n)} mit mindestens einem Start.`;
  }
}

/** Was noch fehlt, z. B. "Noch 4 Besuchstage in dieser Saison." */
export function awardRemainingText(m: { metric: GamiMetric; threshold: number; period: GamiPeriod; value: number }): string {
  const left = Math.max(0, m.threshold - m.value);
  if (m.metric === "EVENT_DAYS") return "Sei an einem Aktionstag am Start.";
  const when = m.period === "MONTH" ? " in diesem Monat" : m.period === "SEASON" ? " in dieser Saison" : "";
  if (m.metric === "WEEKENDS" || m.metric === "STREAK_WEEKS") {
    return `Deine längste Serie${when}: ${fmt(m.value)} von ${fmt(m.threshold)}.`;
  }
  return `Noch ${fmt(left)} ${awardUnit(m.metric, left)}${when}.`;
}

/** Kurzform des Gutscheins für die Kachel: eigener Kurztext, sonst der Teil vor dem Doppelpunkt. */
export function voucherShortLabel(m: { voucherLabel: string | null; voucherShort?: string | null }): string | null {
  if (m.voucherShort?.trim()) return m.voucherShort.trim();
  if (!m.voucherLabel) return null;
  const [head, ...rest] = m.voucherLabel.split(": ");
  return rest.length > 0 ? head : m.voucherLabel;
}

/** Überschrift und Unterzeile eines Gutscheins: "Bring a Friend" und der Rest nach dem Doppelpunkt. */
export function voucherHeadline(label: string, short?: string | null): { head: string; detail: string | null } {
  const [head, ...rest] = label.split(": ");
  if (rest.length > 0) return { head, detail: rest.join(": ") };
  return short?.trim() && short.trim() !== label ? { head: short.trim(), detail: label } : { head: label, detail: null };
}

const TIER_RANK: Record<GamiTier, number> = { BRONZE: 0, SILVER: 1, GOLD: 2, LEGENDARY: 3 };

export function tierRank(tier: GamiTier): number {
  return TIER_RANK[tier];
}

/**
 * Der Award, dem die Person am nächsten ist: der gesperrte mit dem größten
 * Anteil am Ziel. Aktionstage zählen nicht mit (dort gibt es keinen Weg), und
 * Treue-Awards erst, wenn sonst nichts mehr offen ist: eine Saison lässt sich
 * nicht schneller fahren. Ohne jeden Fortschritt der erste der Liste.
 */
export function nextAward<T extends { unlocked: boolean; metric: GamiMetric; threshold: number; value: number }>(
  awards: T[],
): T | null {
  const open = awards.filter((a) => !a.unlocked && a.metric !== "EVENT_DAYS" && a.threshold > 0);
  const reachable = open.filter((a) => a.metric !== "SEASONS");
  const pool = reachable.length > 0 ? reachable : open;
  if (pool.length === 0) return null;
  let best = pool[0];
  for (const a of pool) {
    if (a.value / a.threshold > best.value / best.threshold) best = a;
  }
  return best;
}

/**
 * Breite der Kacheln im Dreier-Raster: bleibt in der letzten Zeile eine
 * Kachel übrig, wird sie breit (3), bleiben zwei, wird die letzte doppelt
 * breit (2).
 */
export function tileSpans(count: number): number[] {
  const rest = count % 3;
  return Array.from({ length: count }, (_, i) => (i === count - 1 && rest === 1 ? 3 : i === count - 1 && rest === 2 ? 2 : 1));
}

export interface AwardDefault {
  key: string;
  name: string;
  tier: GamiTier;
  metric: GamiMetric;
  threshold: number;
  period: GamiPeriod;
  voucherLabel: string;
  voucherShort: string;
  /** Gültigkeit in Tagen; null = ohne Ablauf. */
  voucherValidDays: number | null;
  bonus?: string;
  hint?: string;
}

const YEAR = 365;

/**
 * Vorlage: 20 Awards mit Zielen aus den Scan-Daten 2026 und einem Gutschein
 * aus Imbiss-Karte und Ticketangeboten (mit Aaron am 20.11.2026 abgestimmt).
 * Die Migration `awards_vorlage` legt genau diese Liste an; danach sind alle
 * Werte in der Verwaltung änderbar.
 */
export const AWARD_DEFAULTS: AwardDefault[] = [
  { key: "first-splash", name: "First Splash", tier: "BRONZE", metric: "STARTS", threshold: 1, period: "ALL_TIME", voucherLabel: "Welcome Drink: ein Softdrink nach Wahl", voucherShort: "Welcome Drink", voucherValidDays: YEAR, hint: "Dein allererster Start am Lift." },
  { key: "hooked", name: "Hooked", tier: "BRONZE", metric: "STARTS", threshold: 25, period: "ALL_TIME", voucherLabel: "Ein Eis nach Wahl", voucherShort: "Eis nach Wahl", voucherValidDays: YEAR },
  { key: "cable-rat", name: "Cable Rat", tier: "SILVER", metric: "STARTS", threshold: 100, period: "ALL_TIME", voucherLabel: "Eine Portion Steakhaus Pommes", voucherShort: "Pommes", voucherValidDays: YEAR },
  { key: "lap-machine", name: "Lap Machine", tier: "SILVER", metric: "STARTS", threshold: 250, period: "ALL_TIME", voucherLabel: "Combo nach Wahl: Currywurst, Chicken oder Kibbelinge mit Pommes", voucherShort: "Pommes-Combo", voucherValidDays: YEAR },
  { key: "dock-boss", name: "Dock Boss", tier: "GOLD", metric: "STARTS", threshold: 500, period: "ALL_TIME", voucherLabel: "Bring a Friend: Tageskarte Wake & Ski für eine Begleitung", voucherShort: "Bring a Friend", voucherValidDays: YEAR },
  { key: "thousand-club", name: "Thousand Club", tier: "GOLD", metric: "STARTS", threshold: 1000, period: "ALL_TIME", voucherLabel: "Sunset Session für dich und eine Begleitung", voucherShort: "Sunset Session", voucherValidDays: YEAR },
  { key: "tuttenbrock-legend", name: "Tuttenbrock Legend", tier: "LEGENDARY", metric: "STARTS", threshold: 2500, period: "ALL_TIME", voucherLabel: "Private Session: 1 Stunde Übungslift exklusiv für dich und deine Crew", voucherShort: "Private Session", voucherValidDays: null, hint: "2.500 Starts am Lift. Das Fernziel für die ganz Harten." },

  { key: "regular", name: "Regular", tier: "BRONZE", metric: "VISIT_DAYS", threshold: 5, period: "SEASON", voucherLabel: "Ein Café Crème oder Softdrink", voucherShort: "Freigetränk", voucherValidDays: YEAR },
  { key: "repeat-offender", name: "Repeat Offender", tier: "SILVER", metric: "VISIT_DAYS", threshold: 15, period: "SEASON", voucherLabel: "Steakhaus Pommes und ein Softdrink", voucherShort: "Pommes + Drink", voucherValidDays: YEAR },
  { key: "lake-local", name: "Lake Local", tier: "GOLD", metric: "VISIT_DAYS", threshold: 30, period: "SEASON", voucherLabel: "Bring a Friend: 1 Stunde Wake & Ski für eine Begleitung", voucherShort: "Bring a Friend", voucherValidDays: YEAR },
  { key: "endless-summer", name: "Endless Summer", tier: "LEGENDARY", metric: "VISIT_DAYS", threshold: 50, period: "SEASON", voucherLabel: "Grillplatz für dich und deine Crew", voucherShort: "Grillplatz für die Crew", voucherValidDays: YEAR, bonus: "Hall-of-Fame-Wand" },

  { key: "butter-hunter", name: "Butter Hunter", tier: "SILVER", metric: "EARLY_DAYS", threshold: 5, period: "SEASON", voucherLabel: "Early-Bird-Kaffee: Café Crème oder Cappuccino", voucherShort: "Kaffee", voucherValidDays: YEAR, hint: "5 Tage mit Start in der ersten Stunde, wenn das Wasser noch spiegelglatt ist." },
  { key: "weekend-warrior", name: "Weekend Warrior", tier: "SILVER", metric: "WEEKENDS", threshold: 3, period: "SEASON", voucherLabel: "Ein alkoholfreies Kaltgetränk nach Wahl", voucherShort: "Kaltgetränk", voucherValidDays: YEAR },
  { key: "day-one", name: "Day One", tier: "GOLD", metric: "EVENT_DAYS", threshold: 1, period: "SEASON", voucherLabel: "Opening-Wurst: Bratwurst oder Currywurst", voucherShort: "Opening-Wurst", voucherValidDays: YEAR, hint: "Start am Opening-Tag der Saison." },
  { key: "ice-breaker", name: "Ice Breaker", tier: "GOLD", metric: "EVENT_DAYS", threshold: 1, period: "SEASON", voucherLabel: "Eine heiße Schokolade zum Aufwärmen", voucherShort: "Heiße Schokolade", voucherValidDays: YEAR, hint: "Start an einem Tag mit unter 15 °C Wassertemperatur." },

  { key: "round-two", name: "Round Two", tier: "BRONZE", metric: "SEASONS", threshold: 2, period: "ALL_TIME", voucherLabel: "Die zweite Runde geht aufs Haus: ein Getränk", voucherShort: "Freigetränk", voucherValidDays: YEAR },
  { key: "og-rider", name: "OG Rider", tier: "SILVER", metric: "SEASONS", threshold: 3, period: "ALL_TIME", voucherLabel: "Bring a Friend: Aquapark-Stundenkarte für eine Begleitung", voucherShort: "Bring a Friend", voucherValidDays: YEAR },
  { key: "old-school", name: "Old School", tier: "GOLD", metric: "SEASONS", threshold: 5, period: "ALL_TIME", voucherLabel: "Flammkuchen oder Pinsa für zwei", voucherShort: "2× Flammkuchen", voucherValidDays: YEAR },
  { key: "lifer", name: "Lifer", tier: "GOLD", metric: "SEASONS", threshold: 7, period: "ALL_TIME", voucherLabel: "Ein Abo-Monat geschenkt", voucherShort: "Gratis-Monat", voucherValidDays: null },
  { key: "hall-of-famer", name: "Hall of Famer", tier: "LEGENDARY", metric: "SEASONS", threshold: 10, period: "ALL_TIME", voucherLabel: "50 % auf dein nächstes Abo", voucherShort: "50 % aufs Abo", voucherValidDays: null, bonus: "Gravur an der Wand" },
];

/** Sortierung der Vorlage: hinter selbst angelegten Meilensteinen, in dieser Reihenfolge. */
export const AWARD_DEFAULT_SORT_BASE = 100;
