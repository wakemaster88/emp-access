/**
 * Regeln für Skills der Kunden-App: zeitlich begrenzte Rechte, vor Ort ein
 * Gerät zu schalten (Außendusche, Lichtshow) oder die Musik zu bestimmen.
 *
 * Bewusst ohne Prisma und Netzwerk, damit Oberflächen und Tests es direkt
 * nutzen können. Ausführen und Speichern liegen in `rider-skills.ts`.
 *
 * Grenzen (Aaron, 21.11.2026, „So wie vorgeschlagen“):
 *  - Nutzungen und Ablauf je gewonnenem Skill
 *  - nur während der Betriebszeit am Lift
 *  - nur, wer heute schon am Lift gestartet ist (vor Ort, ohne Standortabfrage)
 *  - je Skill eine Pause nach jeder Nutzung, damit sich keiner festhält
 *  - das Personal kann jeden Skill sperren
 */

import { pulseSeconds } from "./pulse-constants";

export type SkillKind = "DEVICE" | "MUSIC";

/** Kategorien, die ein Skill schalten darf. Türen, Tore, Drehkreuze und Ventile nie. */
export const SKILL_DEVICE_CATEGORIES = ["TASTER", "SCHALTER", "BELEUCHTUNG"] as const;

/** Obergrenzen für die Verwaltung. */
export const MAX_SKILL_MINUTES = 30;
export const MAX_SKILL_COOLDOWN = 120;
export const MAX_SKILL_USES = 100;

/**
 * Darf ein Skill dieses Gerät schalten? Nur Shelly-Taster, -Schalter und
 * -Licht sowie Hue-Lampen. Alles mit Zutritt (Tür, Drehkreuz, Schloss) und
 * Wasser (Ventile, Pumpen) bleibt außen vor.
 */
export function isSkillDevice(device: { type: string; category: string | null }): boolean {
  if (device.type === "HUE_LIGHT") return true;
  if (device.type !== "SHELLY") return false;
  return (SKILL_DEVICE_CATEGORIES as readonly string[]).includes(device.category ?? "");
}

/** So viele Sekunden läuft eine Nutzung: Taster für seine eigene Dauer, sonst die Minuten des Skills. */
export function skillRunSeconds(
  skill: { kind: SkillKind; minutes: number },
  device: { category: string | null; pulseSeconds: number | null } | null,
): number {
  if (skill.kind === "DEVICE" && device?.category === "TASTER") return pulseSeconds(device.pulseSeconds);
  return Math.max(1, Math.min(MAX_SKILL_MINUTES, Math.round(skill.minutes))) * 60;
}

/** „60 Sek.“ bzw. „5 Min.“ */
export function runText(seconds: number): string {
  if (seconds < 120) return `${seconds} Sek.`;
  return `${Math.round(seconds / 60)} Min.`;
}

export type SkillBlock =
  | { kind: "paused" }
  | { kind: "closed" }
  | { kind: "not-on-site" }
  | { kind: "running"; until: Date }
  | { kind: "cooldown"; until: Date }
  | { kind: "used-up" }
  | { kind: "no-target" };

export interface SkillCheckInput {
  skill: { paused: boolean; onlyOperating: boolean; onlyOnSite: boolean; cooldownMinutes: number };
  /** Nutzungen, die der Person noch bleiben (über alle gültigen Vergaben). */
  left: number;
  /** Gerät bzw. Musik-Abstimmung ist eingerichtet. */
  hasTarget: boolean;
  liftOpen: boolean;
  startedToday: boolean;
  /** Letzte geglückte Nutzung dieses Skills, egal von wem. */
  lastUse: { at: Date; until: Date | null } | null;
  now: Date;
}

/** Wann der Skill nach der letzten Nutzung wieder frei ist. */
export function freeAt(lastUse: { at: Date; until: Date | null }, cooldownMinutes: number): Date {
  const end = lastUse.until && lastUse.until > lastUse.at ? lastUse.until : lastUse.at;
  return new Date(end.getTime() + Math.max(0, cooldownMinutes) * 60_000);
}

/**
 * Warum der Skill gerade nicht geht; null = Taste frei. Reihenfolge: was die
 * Person nicht ändern kann zuerst (Sperre, geschlossen), dann was sie tun
 * kann (an den Lift kommen), zuletzt das Warten auf andere.
 */
export function skillBlock(input: SkillCheckInput): SkillBlock | null {
  const { skill, now } = input;
  if (input.left <= 0) return { kind: "used-up" };
  if (!input.hasTarget) return { kind: "no-target" };
  if (skill.paused) return { kind: "paused" };
  if (skill.onlyOperating && !input.liftOpen) return { kind: "closed" };
  if (skill.onlyOnSite && !input.startedToday) return { kind: "not-on-site" };
  if (input.lastUse) {
    if (input.lastUse.until && input.lastUse.until > now) return { kind: "running", until: input.lastUse.until };
    const free = freeAt(input.lastUse, skill.cooldownMinutes);
    if (free > now) return { kind: "cooldown", until: free };
  }
  return null;
}

function hhmm(d: Date): string {
  return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
}

/** Ein Satz für die App unter der Taste. */
export function skillBlockText(block: SkillBlock): string {
  switch (block.kind) {
    case "paused": return "Gerade vom Team gesperrt.";
    case "closed": return "Geht nur, wenn der Lift geöffnet ist.";
    case "not-on-site": return "Geht, sobald du heute am Lift gestartet bist.";
    case "running": return `Läuft gerade, bis ${hhmm(block.until)} Uhr.`;
    case "cooldown": return `Gleich wieder frei, ab ${hhmm(block.until)} Uhr.`;
    case "used-up": return "Alle Nutzungen verbraucht.";
    case "no-target": return "Noch nicht eingerichtet.";
  }
}

/** Belohnung „Skill“ an Award, Challenge oder Feiertag, für die Datenbank aufbereitet. */
export function normalizeSkillReward(input: {
  skillId?: number | null;
  skillUses?: number | null;
  skillValidDays?: number | null;
}): { skillId: number | null; skillUses: number; skillValidDays: number | null } | Record<string, never> {
  if (input.skillId === undefined) return {};
  if (input.skillId == null) return { skillId: null, skillUses: 1, skillValidDays: null };
  const uses = Math.max(1, Math.min(MAX_SKILL_USES, Math.round(input.skillUses ?? 1)));
  return { skillId: input.skillId, skillUses: uses, skillValidDays: input.skillValidDays ?? null };
}

/** „Außendusche · 10×“ für Listen und Push. */
export function skillRewardText(name: string, uses: number): string {
  return uses > 1 ? `${name} · ${uses}×` : name;
}

/** Vergaben einer Person: welche zuerst verbraucht wird (bald ablaufende zuerst). */
export function pickGrant<T extends { uses: number; usedCount: number; expiresAt: Date | null; id: number }>(
  grants: T[],
): T | null {
  const open = grants.filter((g) => g.usedCount < g.uses);
  open.sort((a, b) => {
    const ea = a.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY;
    const eb = b.expiresAt?.getTime() ?? Number.POSITIVE_INFINITY;
    return ea - eb || a.id - b.id;
  });
  return open[0] ?? null;
}

/** Gültige Vergabe: nicht zurückgenommen, nicht abgelaufen. */
export function grantValid(g: { disabledAt: Date | null; expiresAt: Date | null }, now: Date): boolean {
  return g.disabledAt == null && (g.expiresAt == null || g.expiresAt > now);
}
