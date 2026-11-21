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
  currentOption,
  decideZone,
  optionKey,
  parseOptionKey,
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
  /** "p<id>" / "s<id>" in App-Reihenfolge. */
  options: string[];
  holdMinutes: number;
}

export async function loadMusicVoteConfig(db: TenantDb, accountId: number): Promise<MusicVoteConfig | null> {
  const c = await db.gamificationConfig.findUnique({
    where: { accountId },
    select: { musicVoteEnabled: true, musicVoteZoneIds: true, musicVoteOptions: true, musicVoteHoldMinutes: true },
  });
  if (!c) return null;
  return {
    enabled: c.musicVoteEnabled,
    zoneIds: c.musicVoteZoneIds,
    options: c.musicVoteOptions,
    holdMinutes: c.musicVoteHoldMinutes,
  };
}

/** Playlists und Webradios zur Wahl, in der eingestellten Reihenfolge. */
export async function loadVoteOptions(db: TenantDb, accountId: number, keys: string[]): Promise<VoteOption[]> {
  const parsed = keys.map(parseOptionKey).filter((k) => k != null);
  if (parsed.length === 0) return [];
  const playlistIds = parsed.filter((k) => k.kind === "PLAYLIST").map((k) => k.id);
  const streamIds = parsed.filter((k) => k.kind === "STREAM").map((k) => k.id);
  const [playlists, streams] = await Promise.all([
    playlistIds.length
      ? db.audioPlaylist.findMany({ where: { accountId, id: { in: playlistIds } }, select: { id: true, name: true } })
      : [],
    streamIds.length
      ? db.audioStream.findMany({ where: { accountId, id: { in: streamIds } }, select: { id: true, name: true } })
      : [],
  ]);
  const names = new Map<string, string>([
    ...playlists.map((r) => [optionKey("PLAYLIST", r.id), r.name] as [string, string]),
    ...streams.map((r) => [optionKey("STREAM", r.id), r.name] as [string, string]),
  ]);
  return keys.filter((k) => names.has(k)).map((key) => ({ key, name: names.get(key)! }));
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
  /** Stimmen aktiver Fahrer: profileId → Option. */
  votes: Map<number, string>;
}

async function loadStanding(db: TenantDb, accountId: number, config: MusicVoteConfig, now: Date): Promise<Standing> {
  const [options, active, rows] = await Promise.all([
    loadVoteOptions(db, accountId, config.options),
    activeRiders(accountId, now),
    db.riderMusicVote.findMany({
      where: { accountId, day: ymdToDbDate(berlinYmd(now)) },
      select: { profileId: true, option: true },
    }),
  ]);
  const votes = new Map<number, string>();
  for (const r of rows) if (active.has(r.profileId)) votes.set(r.profileId, r.option);
  const tally = tallyVotes(options, [...votes.values()].map((option) => ({ option })));
  return { options, tally, votes };
}

/** Name dessen, was gerade läuft: Playlist, Webradio-Sender oder „Webradio“. */
function playingName(zone: {
  sourceKind: string;
  playlist: { name: string } | null;
  stream: { name: string } | null;
  currentTitle: string | null;
}): string | null {
  if (zone.sourceKind === "PLAYLIST") return zone.playlist?.name ?? zone.currentTitle;
  if (zone.sourceKind === "STREAM") return zone.stream?.name ?? zone.currentTitle ?? "Webradio";
  return zone.currentTitle;
}

export async function loadVoteZones(db: TenantDb, accountId: number, ids: number[]) {
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
      streamId: true,
      streamUrl: true,
      currentTitle: true,
      staffChoiceAt: true,
      riderChoiceUntil: true,
      volume: true,
      playlist: { select: { name: true } },
      stream: { select: { name: true } },
    },
    orderBy: { sortOrder: "asc" },
  });
}

/** Bis wann die Abstimmung in der Zone ruht: Wahl des Personals oder Musik-Skill eines Fahrers. */
function zoneHoldUntil(
  z: { staffChoiceAt: Date | null; riderChoiceUntil: Date | null },
  holdMinutes: number,
  now: Date,
): Date | null {
  const staff = staffHoldUntil(z.staffChoiceAt, holdMinutes, now);
  const rider = z.riderChoiceUntil && z.riderChoiceUntil > now ? z.riderChoiceUntil : null;
  if (!staff) return rider;
  if (!rider) return staff;
  return staff > rider ? staff : rider;
}

export type ApplyResult = { switched: number; winner: string | null };

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
    loadVoteZones(db, accountId, config.zoneIds),
  ]);
  let switched = 0;
  let winner: string | null = null;
  for (const zone of zones) {
    winner = pickWinner(standing.tally, currentOption(zone));
    const decision = decideZone(zone, winner, config.holdMinutes, now);
    if (decision.kind !== "switch") continue;
    if (!(await playOptionInZone(db, accountId, zone, decision.option, "VOTE"))) continue;
    switched++;
  }
  return { switched, winner };
}

/**
 * Playlist oder Webradio ("p…"/"s…") in einer Zone starten. Kein manueller
 * Befehl (`manual: false`): das Musikfenster bleibt, wie es ist. Liefert
 * false, wenn es die Auswahl nicht (mehr) gibt.
 */
export async function playOptionInZone(
  db: TenantDb,
  accountId: number,
  zone: { id: number; volume: number },
  option: string,
  triggerKind: string,
): Promise<boolean> {
  const target = parseOptionKey(option);
  if (!target) return false;
  if (target.kind === "PLAYLIST") {
    const payload = await playlistPayload(db, target.id);
    if (!payload) return false;
    await queueZoneCommand(
      db,
      accountId,
      [zone],
      "PLAY",
      { kind: "PLAYLIST", volume: zone.volume, ...(payload as object), manual: false },
      triggerKind,
    );
    await db.audioZone.update({ where: { id: zone.id }, data: { sourceKind: "PLAYLIST", playlistId: target.id } });
    return true;
  }
  const stream = await db.audioStream.findFirst({
    where: { id: target.id, accountId },
    select: { id: true, name: true, url: true },
  });
  if (!stream) return false;
  await queueZoneCommand(
    db,
    accountId,
    [zone],
    "PLAY",
    { kind: "STREAM", url: stream.url, volume: zone.volume, manual: false },
    triggerKind,
  );
  await db.audioZone.update({
    where: { id: zone.id },
    data: { sourceKind: "STREAM", streamId: stream.id, streamUrl: stream.url, currentTitle: stream.name },
  });
  return true;
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
  if (!config?.enabled || config.zoneIds.length === 0 || config.options.length === 0) return null;
  const [standing, zones, lastStart, mine] = await Promise.all([
    loadStanding(db, accountId, config, now),
    loadVoteZones(db, accountId, config.zoneIds),
    lastStartToday(accountId, profileId, now),
    db.riderMusicVote.findUnique({
      where: { profileId_day: { profileId, day: ymdToDbDate(berlinYmd(now)) } },
      select: { option: true },
    }),
  ]);
  if (standing.options.length === 0) return null;
  const live = zones.filter((z) => z.isActive);
  if (live.length === 0) return null;
  const playing = live.find((z) => z.isPlaying && !z.externalActive) ?? null;
  const hold = live
    .map((z) => zoneHoldUntil(z, config.holdMinutes, now))
    .filter((d): d is Date => d != null)
    .sort((a, b) => a.getTime() - b.getTime())[0];
  const canVote = isActiveRider(lastStart, now);
  return {
    where: live.map((z) => z.name).join(", "),
    options: standing.tally,
    myOption: mine?.option ?? null,
    canVote,
    playingOption: playing ? currentOption(playing) : null,
    playingName: playing ? playingName(playing) : null,
    holdUntil: hold ? hold.toISOString() : null,
    holdBy: hold ? (live.some((z) => z.riderChoiceUntil && z.riderChoiceUntil.getTime() === hold.getTime()) ? "rider" : "staff") : null,
    voters: standing.votes.size,
  };
}

export type CastResult = { ok: true; view: MusicVoteView } | { ok: false; error: string; status: number };

/** Stimme abgeben oder ändern ("p…"/"s…") bzw. zurücknehmen (null). */
export async function castMusicVote(
  accountId: number,
  profileId: number,
  option: string | null,
  now = new Date(),
): Promise<CastResult> {
  const db = tenantClient(accountId);
  const config = await loadMusicVoteConfig(db, accountId);
  if (!config?.enabled) return { ok: false, error: "Die Abstimmung ist gerade aus.", status: 409 };
  const day = ymdToDbDate(berlinYmd(now));
  if (option == null) {
    await db.riderMusicVote.deleteMany({ where: { accountId, profileId, day } });
  } else {
    if (!config.options.includes(option)) {
      return { ok: false, error: "Das steht gerade nicht zur Wahl.", status: 400 };
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
      create: { accountId, profileId, day, option },
      update: { option },
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
    loadVoteZones(db, accountId, config.zoneIds),
  ]);
  return {
    tally: standing.tally,
    voters: standing.votes.size,
    zones: zones.map((z) => {
      const hold = zoneHoldUntil(z, config.holdMinutes, now);
      return {
        id: z.id,
        name: z.name,
        isPlaying: z.isPlaying,
        playing: z.isPlaying ? playingName(z) : null,
        holdUntil: hold ? hold.toISOString() : null,
      };
    }),
  };
}
