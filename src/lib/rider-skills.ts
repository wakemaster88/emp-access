/**
 * Skills der Kunden-App: vergeben, anzeigen, auslösen. Regeln (Grenzen,
 * Texte) in `rider-skill-rules.ts`.
 *
 * Ein Skill wird wie ein Gutschein an ein Ticket vergeben (`RiderSkillGrant`)
 * und gilt für die Person hinter dem Ticket. Beim Auslösen wird zuerst die
 * Nutzung gebucht (unter einer Sperre je Skill, damit zwei Fahrer nicht
 * gleichzeitig durch die Pause kommen), dann geschaltet. Klappt das Schalten
 * nicht, gibt es die Nutzung zurück.
 */
import { prisma, tenantClient, type TenantDb } from "./prisma";
import { berlinYmd } from "./berlin-day";
import { ymdToDbDate } from "./gamification";
import { triggerDeviceAction } from "./device-open";
import { operatingSpanState } from "./operating-hours";
import { scheduleSpecInclude, toScheduleSpec } from "./operating-queries";
import { pickLiftSchedule } from "./rider-opening";
import { loadMusicVoteConfig, loadVoteOptions, loadVoteZones, playOptionInZone } from "./music-vote";
import type { VoteOption } from "./music-vote-rules";
import { notifySkill } from "./rider-push";
import {
  grantValid,
  isSkillDevice,
  pickGrant,
  runText,
  skillBlock,
  skillBlockText,
  skillRewardText,
  skillRunSeconds,
  type SkillBlock,
  type SkillKind,
} from "./rider-skill-rules";

/** Namensraum für pg_advisory_xact_lock(int, int): eine Nutzung je Skill zugleich. */
const SKILL_LOCK = 7310;

const DEVICE_SELECT = {
  id: true,
  name: true,
  type: true,
  category: true,
  shellyId: true,
  ipAddress: true,
  pulseSeconds: true,
  hueBridgeId: true,
  hueLightId: true,
} as const;

/** Skill an ein Ticket vergeben (Award, Challenge, Feiertag). Gibt die Vergabe-ID zurück oder null. */
export async function grantSkill(
  db: TenantDb,
  input: { accountId: number; ticketId: number; skillId: number; uses: number; validDays: number | null; source: string },
): Promise<number | null> {
  const skill = await db.riderSkill.findFirst({
    where: { id: input.skillId, accountId: input.accountId, active: true },
    select: { id: true, name: true },
  });
  if (!skill) return null;
  const grant = await db.riderSkillGrant.create({
    data: {
      skillId: skill.id,
      ticketId: input.ticketId,
      uses: Math.max(1, input.uses),
      expiresAt: input.validDays ? new Date(Date.now() + input.validDays * 86_400_000) : null,
      source: input.source,
      accountId: input.accountId,
    },
    select: { id: true },
  });
  notifySkill(input.accountId, input.ticketId, skillRewardText(skill.name, input.uses));
  return grant.id;
}

/** Ist der Lift jetzt geöffnet (Betriebszeiten, wie die Karte „Auslastung jetzt“)? Ohne Profil: nein. */
export async function liftOpenNow(accountId: number, now: Date = new Date()): Promise<boolean> {
  const schedules = await prisma.operatingSchedule.findMany({
    // Unterprofile (Bahnmieten, Kurse) sind keine eigenen Bereiche.
    where: { accountId, parentId: null },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    include: scheduleSpecInclude,
  });
  const schedule = pickLiftSchedule(schedules);
  if (!schedule) return false;
  return operatingSpanState(toScheduleSpec(schedule), now, undefined, { openMinutes: 0, closeMinutes: 0 }, 1).inside;
}

async function startedToday(db: TenantDb, accountId: number, ticketIds: number[], now: Date): Promise<boolean> {
  if (ticketIds.length === 0) return false;
  const row = await db.riderDayStat.findFirst({
    where: { accountId, ticketId: { in: ticketIds }, day: ymdToDbDate(berlinYmd(now)), starts: { gt: 0 } },
    select: { id: true },
  });
  return row != null;
}

async function lastUses(db: TenantDb, accountId: number, skillIds: number[]) {
  if (skillIds.length === 0) return new Map<number, { at: Date; until: Date | null }>();
  const rows = await db.riderSkillUse.findMany({
    where: { accountId, skillId: { in: skillIds }, ok: true, createdAt: { gte: new Date(Date.now() - 86_400_000) } },
    orderBy: { createdAt: "desc" },
    select: { skillId: true, createdAt: true, until: true },
  });
  const out = new Map<number, { at: Date; until: Date | null }>();
  for (const r of rows) if (!out.has(r.skillId)) out.set(r.skillId, { at: r.createdAt, until: r.until });
  return out;
}

export interface RiderSkillView {
  id: number;
  name: string;
  description: string | null;
  kind: SkillKind;
  /** Nutzungen übrig (alle gültigen Vergaben zusammen). */
  left: number;
  /** Nächster Ablauf einer Vergabe mit offenen Nutzungen. */
  expiresAt: Date | null;
  /** Woher, z. B. „Award Day One (2027)“. */
  source: string;
  /** „60 Sek.“ / „5 Min.“ */
  runs: string;
  /** null = Taste frei. */
  block: SkillBlock | null;
  blockText: string | null;
  /** MUSIC: Auswahl aus der Playlist-Abstimmung. */
  options: VoteOption[];
}

interface SkillContext {
  liftOpen: boolean;
  startedToday: boolean;
  music: { enabled: boolean; options: VoteOption[]; zoneIds: number[] } | null;
}

async function loadContext(db: TenantDb, accountId: number, ticketIds: number[], needMusic: boolean, now: Date): Promise<SkillContext> {
  const [liftOpen, started, musicConfig] = await Promise.all([
    liftOpenNow(accountId, now),
    startedToday(db, accountId, ticketIds, now),
    needMusic ? loadMusicVoteConfig(db, accountId) : Promise.resolve(null),
  ]);
  let music: SkillContext["music"] = null;
  if (musicConfig) {
    const options = await loadVoteOptions(db, accountId, musicConfig.options);
    music = { enabled: musicConfig.enabled, options, zoneIds: musicConfig.zoneIds };
  }
  return { liftOpen, startedToday: started, music };
}

function hasTarget(
  skill: { kind: SkillKind; device: { type: string; category: string | null } | null },
  ctx: SkillContext,
): boolean {
  if (skill.kind === "DEVICE") return skill.device != null && isSkillDevice(skill.device);
  return !!ctx.music && ctx.music.zoneIds.length > 0 && ctx.music.options.length > 0;
}

/** Skills einer Person für die Kunden-App: nur mit offenen Nutzungen und aktiv. */
export async function loadRiderSkills(
  rider: { accountId: number; ticketIds: number[] },
  now: Date = new Date(),
): Promise<RiderSkillView[]> {
  const { accountId, ticketIds } = rider;
  if (ticketIds.length === 0) return [];
  const db = tenantClient(accountId);
  const grants = await db.riderSkillGrant.findMany({
    where: {
      accountId,
      ticketId: { in: ticketIds },
      disabledAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      skill: { active: true },
    },
    select: {
      id: true, uses: true, usedCount: true, expiresAt: true, disabledAt: true, source: true, skillId: true,
      skill: {
        select: {
          id: true, name: true, description: true, kind: true, minutes: true, cooldownMinutes: true,
          onlyOperating: true, onlyOnSite: true, paused: true, sortOrder: true,
          device: { select: DEVICE_SELECT },
        },
      },
    },
  });
  const open = grants.filter((g) => g.usedCount < g.uses && grantValid(g, now));
  if (open.length === 0) return [];

  const bySkill = new Map<number, typeof open>();
  for (const g of open) bySkill.set(g.skillId, [...(bySkill.get(g.skillId) ?? []), g]);
  const skills = [...bySkill.values()].map((gs) => gs[0].skill);
  const ctx = await loadContext(db, accountId, ticketIds, skills.some((s) => s.kind === "MUSIC"), now);
  const last = await lastUses(db, accountId, skills.map((s) => s.id));

  return skills
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
    .map((s) => {
      const gs = bySkill.get(s.id)!;
      const left = gs.reduce((n, g) => n + (g.uses - g.usedCount), 0);
      const next = pickGrant(gs)!;
      const block = skillBlock({
        skill: s,
        left,
        hasTarget: hasTarget(s, ctx),
        liftOpen: ctx.liftOpen,
        startedToday: ctx.startedToday,
        lastUse: last.get(s.id) ?? null,
        now,
      });
      return {
        id: s.id,
        name: s.name,
        description: s.description,
        kind: s.kind,
        left,
        expiresAt: next.expiresAt,
        source: next.source,
        runs: runText(skillRunSeconds(s, s.device)),
        block,
        blockText: block ? skillBlockText(block) : null,
        options: s.kind === "MUSIC" ? ctx.music?.options ?? [] : [],
      };
    });
}

export type TriggerSkillResult =
  | { ok: true; text: string; skills: RiderSkillView[] }
  | { ok: false; error: string; status: number };

/**
 * Skill auslösen. `option` nur beim Musik-Joker ("p…"/"s…"). Prüft alle
 * Grenzen, bucht die Nutzung und schaltet.
 */
export async function triggerRiderSkill(
  rider: { accountId: number; profileId: number; ticketIds: number[] },
  skillId: number,
  option: string | null,
  now: Date = new Date(),
): Promise<TriggerSkillResult> {
  const { accountId, ticketIds } = rider;
  const db = tenantClient(accountId);
  const config = await db.gamificationConfig.findUnique({ where: { accountId }, select: { enabled: true } });
  if (!config?.enabled) return { ok: false, error: "Die Kunden-App ist gerade aus.", status: 409 };
  const skill = await db.riderSkill.findFirst({
    where: { id: skillId, accountId, active: true },
    include: { device: { select: DEVICE_SELECT } },
  });
  if (!skill) return { ok: false, error: "Diesen Skill gibt es nicht mehr.", status: 404 };

  const ctx = await loadContext(db, accountId, ticketIds, skill.kind === "MUSIC", now);
  if (skill.kind === "MUSIC" && (!option || !ctx.music?.options.some((o) => o.key === option))) {
    return { ok: false, error: "Bitte wähle eine Musik aus der Liste.", status: 400 };
  }
  const seconds = skillRunSeconds(skill, skill.device);
  const until = new Date(now.getTime() + seconds * 1000);

  // Nutzung buchen: unter der Sperre je Skill Grenzen prüfen, Vergabe zählen, Protokoll anlegen.
  const booked = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SKILL_LOCK}::int, ${skill.id}::int)`;
    const grants = await tx.riderSkillGrant.findMany({
      where: { accountId, skillId: skill.id, ticketId: { in: ticketIds }, disabledAt: null },
      select: { id: true, uses: true, usedCount: true, expiresAt: true, disabledAt: true },
    });
    const valid = grants.filter((g) => grantValid(g, now));
    const left = valid.reduce((n, g) => n + Math.max(0, g.uses - g.usedCount), 0);
    const lastRow = await tx.riderSkillUse.findFirst({
      where: { accountId, skillId: skill.id, ok: true },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, until: true },
    });
    const block = skillBlock({
      skill,
      left,
      hasTarget: hasTarget(skill, ctx),
      liftOpen: ctx.liftOpen,
      startedToday: ctx.startedToday,
      lastUse: lastRow ? { at: lastRow.createdAt, until: lastRow.until } : null,
      now,
    });
    if (block) return { error: skillBlockText(block) };
    const grant = pickGrant(valid)!;
    const counted = await tx.riderSkillGrant.updateMany({
      where: { id: grant.id, accountId, usedCount: { lt: grant.uses } },
      data: { usedCount: { increment: 1 } },
    });
    if (counted.count !== 1) return { error: "Alle Nutzungen verbraucht." };
    const use = await tx.riderSkillUse.create({
      data: {
        accountId,
        skillId: skill.id,
        grantId: grant.id,
        profileId: rider.profileId,
        ok: true,
        option: skill.kind === "MUSIC" ? option : null,
        until,
        // Shelly schaltet über den eigenen Timer ab; nur Hue braucht den Cron.
        offDone: !(skill.kind === "DEVICE" && skill.device?.type === "HUE_LIGHT"),
        createdAt: now,
      },
      select: { id: true },
    });
    return { useId: use.id, grantId: grant.id };
  });
  if ("error" in booked) return { ok: false, error: booked.error ?? "Geht gerade nicht.", status: 409 };

  let error: string | null = null;
  try {
    if (skill.kind === "DEVICE") {
      const res = await triggerDeviceAction(db, skill.device!, accountId, "open", { autoOffSec: seconds });
      if (!res.sent) error = res.error ?? "Das Gerät hat nicht geantwortet.";
    } else {
      const zones = (await loadVoteZones(db, accountId, ctx.music!.zoneIds)).filter(
        (z) => z.isActive && z.deviceId != null && z.isPlaying && !z.externalActive,
      );
      let played = 0;
      for (const zone of zones) {
        if (await playOptionInZone(db, accountId, zone, option!, "SKILL")) {
          await db.audioZone.update({ where: { id: zone.id }, data: { riderChoiceUntil: until } });
          played++;
        }
      }
      if (played === 0) error = "Gerade läuft keine Musik, die du wechseln kannst.";
    }
  } catch (e) {
    console.error("[rider-skills] schalten fehlgeschlagen:", e);
    error = "Das hat nicht geklappt. Versuch es gleich noch einmal.";
  }

  if (error) {
    // Nutzung zurückgeben und im Protokoll als Fehler vermerken.
    await db.riderSkillGrant.updateMany({
      where: { id: booked.grantId, accountId, usedCount: { gt: 0 } },
      data: { usedCount: { decrement: 1 } },
    });
    await db.riderSkillUse.update({ where: { id: booked.useId }, data: { ok: false, error, offDone: true } });
    return { ok: false, error, status: 502 };
  }

  const text =
    skill.kind === "MUSIC"
      ? `Deine Musik läuft jetzt ${runText(seconds)}.`
      : `${skill.name} läuft jetzt ${runText(seconds)}.`;
  return { ok: true, text, skills: await loadRiderSkills(rider, now) };
}

/** Jede Minute (Audio-Cron): Hue-Lampen aus Skills nach Ablauf wieder ausschalten. */
export async function runSkillOffTick(now: Date = new Date()): Promise<{ off: number; errors: string[] }> {
  const due = await prisma.riderSkillUse.findMany({
    where: { ok: true, offDone: false, until: { lte: now } },
    select: { id: true, accountId: true, skill: { select: { device: { select: DEVICE_SELECT } } } },
    take: 50,
  });
  const out = { off: 0, errors: [] as string[] };
  for (const u of due) {
    const device = u.skill.device;
    try {
      if (device) await triggerDeviceAction(tenantClient(u.accountId), device, u.accountId, "deactivate");
      out.off++;
    } catch (e) {
      out.errors.push(`Nutzung ${u.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
    await prisma.riderSkillUse.update({ where: { id: u.id }, data: { offDone: true } });
  }
  return out;
}

/** Gehört der Skill einer Belohnung zum Mandanten? Fehlt er oder ist er leer: ja. */
export async function skillRewardAllowed(db: TenantDb, accountId: number, skillId: number | null | undefined): Promise<boolean> {
  if (skillId == null) return true;
  return (await db.riderSkill.findFirst({ where: { id: skillId, accountId }, select: { id: true } })) != null;
}

/** Darf der Skill dieses Gerät schalten (Mandant, Typ, Kategorie)? */
export async function skillDeviceAllowed(db: TenantDb, accountId: number, deviceId: number | null): Promise<boolean> {
  if (deviceId == null) return true;
  const device = await db.device.findFirst({ where: { id: deviceId, accountId }, select: { type: true, category: true } });
  return device != null && isSkillDevice(device);
}
