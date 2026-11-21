/**
 * Playlist-Abstimmung der Fahrer (Kunden-App) und ihre Umsetzung an den
 * Audio-Zonen. Regeln in `music-vote-rules.ts`.
 *
 * Die Mehrheit wird gleich nach jeder Stimme angewandt und zusätzlich jede
 * Minute im Audio-Cron (Fahrer werden inaktiv, die Zone startet oder das
 * Personal gibt die Zone wieder frei).
 */
import { prisma, tenantClient, type TenantDb } from "./prisma";
import { berlinYmd } from "./berlin-day";
import { ymdToDbDate } from "./gamification";
import { playlistPayload, queueZoneCommand } from "./audio";
import {
  VOTE_ACTIVE_MS,
  decideZone,
  isActiveRider,
  pickWinner,
  staffHoldUntil,
  tallyVotes,
  type MusicVoteView,
  type VoteOption,
  type VoteTally,
} from "./music-vote-rules";

export interface MusicVoteConfig {
  enabled: boolean;
  zoneIds: number[];
  playlistIds: number[];
  holdMinutes: number;
}

export async function loadMusicVoteConfig(db: TenantDb, accountId: number): Promise<MusicVoteConfig | null> {
  const c = await db.gamificationConfig.findUnique({
    where: { accountId },
    select: { musicVoteEnabled: true, musicVoteZoneIds: true, musicVotePlaylistIds: true, musicVoteHoldMinutes: true },
  });
  if (!c) return null;
  return {
    enabled: c.musicVoteEnabled,
    zoneIds: c.musicVoteZoneIds,
    playlistIds: c.musicVotePlaylistIds,
    holdMinutes: c.musicVoteHoldMinutes,
  };
}

/** Playlists zur Wahl, in der eingestellten Reihenfolge. */
async function loadOptions(db: TenantDb, accountId: number, ids: number[]): Promise<VoteOption[]> {
  if (ids.length === 0) return [];
  const rows = await db.audioPlaylist.findMany({
    where: { accountId, id: { in: ids } },
    select: { id: true, name: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((r): r is VoteOption => r != null);
}

/** Letzter Start heute je Person, nur Personen mit Start in den letzten 2 Stunden. */
async function activeRiders(accountId: number, now: Date): Promise<Map<number, Date>> {
  const rows = await tenantClient(accountId).riderDayStat.findMany({
    where: {
      accountId,
      day: ymdToDbDate(berlinYmd(now)),
      lastStartAt: { gte: new Date(now.getTime() - VOTE_ACTIVE_MS) },
      ticket: { riderProfileId: { not: null } },
    },
    select: { lastStartAt: true, ticket: { select: { riderProfileId: true } } },
  });
  const out = new Map<number, Date>();
  for (const r of rows) {
    const id = r.ticket.riderProfileId!;
    const prev = out.get(id);
    if (!prev || prev < r.lastStartAt) out.set(id, r.lastStartAt);
  }
  return out;
}

/** Letzter Start heute einer Person (über alle ihre Tickets). */
async function lastStartToday(accountId: number, profileId: number, now: Date): Promise<Date | null> {
  const row = await tenantClient(accountId).riderDayStat.findFirst({
    where: { accountId, day: ymdToDbDate(berlinYmd(now)), ticket: { riderProfileId: profileId } },
    orderBy: { lastStartAt: "desc" },
    select: { lastStartAt: true },
  });
  return row?.lastStartAt ?? null;
}

interface Standing {
  options: VoteOption[];
  tally: VoteTally[];
  /** Stimmen aktiver Fahrer: profileId → playlistId. */
  votes: Map<number, number>;
}

async function loadStanding(db: TenantDb, accountId: number, config: MusicVoteConfig, now: Date): Promise<Standing> {
  const [options, active, rows] = await Promise.all([
    loadOptions(db, accountId, config.playlistIds),
    activeRiders(accountId, now),
    db.riderMusicVote.findMany({
      where: { accountId, day: ymdToDbDate(berlinYmd(now)) },
      select: { profileId: true, playlistId: true },
    }),
  ]);
  const votes = new Map<number, number>();
  for (const r of rows) if (active.has(r.profileId)) votes.set(r.profileId, r.playlistId);
  const tally = tallyVotes(options, [...votes.values()].map((playlistId) => ({ playlistId })));
  return { options, tally, votes };
}

async function loadZones(db: TenantDb, accountId: number, ids: number[]) {
  if (ids.length === 0) return [];
  return db.audioZone.findMany({
    where: { accountId, id: { in: ids } },
    select: {
      id: true,
      name: true,
      isActive: true,
      deviceId: true,
      isPlaying: true,
      externalActive: true,
      sourceKind: true,
      playlistId: true,
      staffChoiceAt: true,
      volume: true,
      playlist: { select: { name: true } },
    },
    orderBy: { sortOrder: "asc" },
  });
}

export type ApplyResult = { switched: number; winner: number | null };

/**
 * Mehrheit an den Zonen umsetzen. Wechselt nur Zonen, in denen gerade
 * eigene Musik läuft und das Personal nicht eben selbst gewählt hat. Der
 * Befehl ist kein manueller (`manual: false`): das Musikfenster bleibt, wie
 * es ist.
 */
export async function applyMusicVote(accountId: number, now = new Date()): Promise<ApplyResult> {
  const db = tenantClient(accountId);
  const config = await loadMusicVoteConfig(db, accountId);
  if (!config?.enabled || config.zoneIds.length === 0) return { switched: 0, winner: null };
  const [standing, zones] = await Promise.all([
    loadStanding(db, accountId, config, now),
    loadZones(db, accountId, config.zoneIds),
  ]);
  let switched = 0;
  let winner: number | null = null;
  for (const zone of zones) {
    const current = zone.sourceKind === "PLAYLIST" ? zone.playlistId : null;
    winner = pickWinner(standing.tally, current);
    const decision = decideZone(zone, winner, config.holdMinutes, now);
    if (decision.kind !== "switch") continue;
    const payload = await playlistPayload(db, decision.playlistId);
    if (!payload) continue;
    await queueZoneCommand(
      db,
      accountId,
      [zone],
      "PLAY",
      { kind: "PLAYLIST", volume: zone.volume, ...(payload as object), manual: false },
      "VOTE",
    );
    await db.audioZone.update({
      where: { id: zone.id },
      data: { sourceKind: "PLAYLIST", playlistId: decision.playlistId },
    });
    switched++;
  }
  return { switched, winner };
}

/** Jede Minute aus dem Audio-Cron: alle Mandanten mit eingeschalteter Abstimmung. */
export async function runMusicVoteTick(now = new Date()): Promise<{ accounts: number; switched: number; errors: string[] }> {
  const configs = await prisma.gamificationConfig.findMany({
    where: { musicVoteEnabled: true, account: { isActive: true } },
    select: { accountId: true },
  });
  const result = { accounts: configs.length, switched: 0, errors: [] as string[] };
  for (const { accountId } of configs) {
    try {
      result.switched += (await applyMusicVote(accountId, now)).switched;
    } catch (error) {
      result.errors.push(`Konto ${accountId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return result;
}

/** Ansicht für die Kunden-App; null = Abstimmung aus oder nichts zur Wahl. */
export async function loadMusicVoteView(
  accountId: number,
  profileId: number,
  now = new Date(),
): Promise<MusicVoteView | null> {
  const db = tenantClient(accountId);
  const config = await loadMusicVoteConfig(db, accountId);
  if (!config?.enabled || config.zoneIds.length === 0 || config.playlistIds.length === 0) return null;
  const [standing, zones, lastStart, mine] = await Promise.all([
    loadStanding(db, accountId, config, now),
    loadZones(db, accountId, config.zoneIds),
    lastStartToday(accountId, profileId, now),
    db.riderMusicVote.findUnique({
      where: { profileId_day: { profileId, day: ymdToDbDate(berlinYmd(now)) } },
      select: { playlistId: true },
    }),
  ]);
  if (standing.options.length === 0) return null;
  const live = zones.filter((z) => z.isActive);
  if (live.length === 0) return null;
  const playing = live.find((z) => z.isPlaying && !z.externalActive) ?? null;
  const hold = live
    .map((z) => staffHoldUntil(z.staffChoiceAt, config.holdMinutes, now))
    .filter((d): d is Date => d != null)
    .sort((a, b) => a.getTime() - b.getTime())[0];
  const canVote = isActiveRider(lastStart, now);
  return {
    where: live.map((z) => z.name).join(", "),
    options: standing.tally,
    myPlaylistId: mine?.playlistId ?? null,
    canVote,
    playingPlaylistId: playing && playing.sourceKind === "PLAYLIST" ? playing.playlistId : null,
    playingName: playing ? (playing.sourceKind === "PLAYLIST" ? playing.playlist?.name ?? null : "Webradio") : null,
    holdUntil: hold ? hold.toISOString() : null,
    voters: standing.votes.size,
  };
}

export type CastResult = { ok: true; view: MusicVoteView } | { ok: false; error: string; status: number };

/** Stimme abgeben oder ändern (playlistId) bzw. zurücknehmen (null). */
export async function castMusicVote(
  accountId: number,
  profileId: number,
  playlistId: number | null,
  now = new Date(),
): Promise<CastResult> {
  const db = tenantClient(accountId);
  const config = await loadMusicVoteConfig(db, accountId);
  if (!config?.enabled) return { ok: false, error: "Die Abstimmung ist gerade aus.", status: 409 };
  const day = ymdToDbDate(berlinYmd(now));
  if (playlistId == null) {
    await db.riderMusicVote.deleteMany({ where: { accountId, profileId, day } });
  } else {
    if (!config.playlistIds.includes(playlistId)) {
      return { ok: false, error: "Diese Playlist steht nicht zur Wahl.", status: 400 };
    }
    if (!isActiveRider(await lastStartToday(accountId, profileId, now), now)) {
      return {
        ok: false,
        error: "Abstimmen kann, wer in den letzten 2 Stunden am Lift gestartet ist.",
        status: 403,
      };
    }
    await db.riderMusicVote.upsert({
      where: { profileId_day: { profileId, day } },
      create: { accountId, profileId, day, playlistId },
      update: { playlistId },
    });
  }
  await applyMusicVote(accountId, now).catch((e) => console.error("[music-vote] anwenden", e));
  const view = await loadMusicVoteView(accountId, profileId, now);
  if (!view) return { ok: false, error: "Die Abstimmung ist gerade aus.", status: 409 };
  return { ok: true, view };
}

/** Stand für die Verwaltung: Stimmen je Playlist und Zustand der Zonen. */
export async function loadMusicVoteAdmin(accountId: number, now = new Date()) {
  const db = tenantClient(accountId);
  const config = await loadMusicVoteConfig(db, accountId);
  if (!config) return null;
  const [standing, zones] = await Promise.all([
    loadStanding(db, accountId, config, now),
    loadZones(db, accountId, config.zoneIds),
  ]);
  return {
    tally: standing.tally,
    voters: standing.votes.size,
    zones: zones.map((z) => {
      const hold = staffHoldUntil(z.staffChoiceAt, config.holdMinutes, now);
      return {
        id: z.id,
        name: z.name,
        isPlaying: z.isPlaying,
        playing: z.isPlaying ? (z.sourceKind === "PLAYLIST" ? z.playlist?.name ?? null : "Webradio") : null,
        holdUntil: hold ? hold.toISOString() : null,
      };
    }),
  };
}
