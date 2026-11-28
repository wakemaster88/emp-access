/**
 * Eine Audio-Zone folgt der Wiedergabe einer anderen (z. B. Shop folgt Insel).
 *
 * Die folgende Zone spielt dieselbe Quelle wie die gefolgte und startet und
 * stoppt mit ihr; Lautstärke und Durchsagen bleiben je Zone. Abgeglichen wird
 * beim Abruf des Abspielers (Pi oder Monitor, `playerStateBody`): Weicht der
 * Stand der gefolgten Zone vom zuletzt weitergegebenen ab, bekommt die folgende
 * Zone einen PLAY- oder STOP-Befehl. So wirkt alles, was die gefolgte Zone
 * startet oder stoppt – Dashboard, Zeitplan, Regel, ihre Musik-Automatik am Pi –,
 * ohne dass die Abspieler etwas Neues können müssen.
 *
 * Maßgeblich ist, was die gefolgte Zone meldet (`isPlaying`), nicht was ihr
 * zuletzt befohlen wurde: Startet ihr Pi zum Fensterbeginn von selbst oder ist
 * er aus, merkt das die folgende Zone erst so.
 *
 * Steuert jemand die folgende Zone direkt (Stopp im Shop, Zeitplan, Regel),
 * gilt das, bis sich die gefolgte Zone ändert oder hier jemand Start drückt
 * (`followState` = "HOLD:<Stand>").
 *
 * Hat die folgende Zone eine eigene Musik-Automatik (Musikzeiten oder
 * Betriebszeit ihres Raums), folgt sie nur in diesem Fenster: Shop folgt der
 * Insel, aber nur zu den Öffnungszeiten des Shops. Außerhalb gilt „Stopp“, ein
 * Start von Hand geht wie sonst vor (`musicOverrideUntil`).
 */
import type { Prisma } from "@prisma/client";
import type { TenantDb } from "@/lib/prisma";
import { zonePlayerOnline } from "@/lib/audio-constants";

/** `triggerKind` der Befehle, die der Abgleich anlegt (Verlauf: „Folgt Zone“). */
export const FOLLOW_TRIGGER = "FOLLOW";

const HOLD_PREFIX = "HOLD:";

/** Was vom Stand der gefolgten Zone gebraucht wird. */
export const followLeaderSelect = {
  id: true,
  name: true,
  isActive: true,
  isPlaying: true,
  externalActive: true,
  sourceKind: true,
  streamUrl: true,
  playlistId: true,
  currentTitle: true,
  monitorId: true,
  lastStateAt: true,
  device: { select: { lastUpdate: true } },
  stream: { select: { url: true } },
} satisfies Prisma.AudioZoneSelect;

export type FollowLeader = Prisma.AudioZoneGetPayload<{ select: typeof followLeaderSelect }>;

/** Was die folgende Zone spielen soll. */
export type FollowTarget =
  | { kind: "STOP" }
  | { kind: "STREAM"; url: string }
  | { kind: "PLAYLIST"; playlistId: number };

export interface LeaderState {
  isActive: boolean;
  online: boolean;
  isPlaying: boolean;
  externalActive: string | null;
  sourceKind: string;
  streamUrl: string | null;
  playlistId: number | null;
}

export function toLeaderState(leader: FollowLeader): LeaderState {
  return {
    isActive: leader.isActive,
    online: zonePlayerOnline(leader),
    isPlaying: leader.isPlaying,
    externalActive: leader.externalActive,
    sourceKind: leader.sourceKind,
    streamUrl: leader.stream?.url ?? leader.streamUrl,
    playlistId: leader.playlistId,
  };
}

/**
 * Was die gefolgte Zone gerade spielt. Nur ihre eigene Musik zählt: AirPlay
 * oder Bluetooth lassen sich nicht weiterreichen, ein abgeschalteter oder
 * stummer Abspieler spielt nichts.
 */
export function leaderTarget(leader: LeaderState): FollowTarget {
  if (!leader.isActive || !leader.online || !leader.isPlaying || leader.externalActive) {
    return { kind: "STOP" };
  }
  if (leader.sourceKind === "STREAM" && leader.streamUrl) {
    return { kind: "STREAM", url: leader.streamUrl };
  }
  if (leader.sourceKind === "PLAYLIST" && leader.playlistId) {
    return { kind: "PLAYLIST", playlistId: leader.playlistId };
  }
  return { kind: "STOP" };
}

/** Musikfenster der folgenden Zone, wie `musicWindowState` es liefert. */
export interface FollowWindow {
  /** Darf die folgende Zone jetzt Musik spielen? Ohne Automatik immer. */
  allowed: boolean;
  /** Nur erlaubt, weil jemand außerhalb des Fensters Start gedrückt hat. */
  manual?: boolean;
}

/**
 * Was die folgende Zone spielen soll: den Stand der gefolgten Zone, aber nur
 * in ihrem eigenen Musikfenster. Außerhalb ist es „Stopp“.
 */
export function followTarget(leader: LeaderState, window: FollowWindow = { allowed: true }): FollowTarget {
  if (!window.allowed) return { kind: "STOP" };
  return leaderTarget(leader);
}

export function followSignature(target: FollowTarget): string {
  if (target.kind === "STREAM") return `STREAM:${target.url}`;
  if (target.kind === "PLAYLIST") return `PLAYLIST:${target.playlistId}`;
  return "STOP";
}

/** Stand nach einem direkten Befehl an die folgende Zone. */
export function holdState(target: FollowTarget): string {
  return HOLD_PREFIX + followSignature(target);
}

export function isHoldState(state: string | null | undefined): boolean {
  return typeof state === "string" && state.startsWith(HOLD_PREFIX);
}

export interface FollowStep {
  /** Befehl an die folgende Zone, null = nichts zu tun. */
  send: FollowTarget | null;
  nextState: string;
  /** Direkt gesteuert: die Zone spielt so lange ihren eigenen Stand. */
  hold: boolean;
}

/** Abgleich: zuletzt weitergegebener Stand gegen den jetzigen der gefolgten Zone. */
export function followStep(state: string | null, target: FollowTarget): FollowStep {
  const signature = followSignature(target);
  if (isHoldState(state)) {
    if (state!.slice(HOLD_PREFIX.length) === signature) {
      return { send: null, nextState: state!, hold: true };
    }
    return { send: target, nextState: signature, hold: false };
  }
  if (state === signature) return { send: null, nextState: signature, hold: false };
  return { send: target, nextState: signature, hold: false };
}

function normalizeTitle(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Passt der gemeldete Titel (Pi: Tag des Titels, Monitor: Titelname) zum Track? */
export function titleMatches(
  track: { title: string; artist?: string | null },
  reported: string
): boolean {
  const wanted = normalizeTitle(reported);
  if (!wanted) return false;
  const title = normalizeTitle(track.title);
  if (title === wanted) return true;
  const artist = track.artist ? normalizeTitle(track.artist) : "";
  return artist !== "" && `${artist} - ${title}` === wanted;
}

/**
 * Reihenfolge für die folgende Zone: Sie beginnt mit dem Titel, den die
 * gefolgte gerade spielt, danach der Reihe nach bzw. gemischt.
 */
export function followTrackOrder<T extends { title: string; artist?: string | null }>(
  tracks: T[],
  currentTitle: string | null,
  shuffle: boolean,
  random: () => number = Math.random
): T[] {
  const start = currentTitle ? tracks.findIndex((track) => titleMatches(track, currentTitle)) : -1;
  if (!shuffle) {
    return start <= 0 ? [...tracks] : [...tracks.slice(start), ...tracks.slice(0, start)];
  }
  const first = start >= 0 ? [tracks[start]] : [];
  const rest = tracks.filter((_, index) => index !== start);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [...first, ...rest];
}

// ── Datenbank ───────────────────────────────────────────────────────────────

const playlistInclude = {
  items: {
    orderBy: { sortOrder: "asc" },
    include: { track: { select: { id: true, title: true, artist: true, url: true } } },
  },
} satisfies Prisma.AudioPlaylistInclude;

/** Playlist der gefolgten Zone, wie sie im Zonenstand des Abspielers steht. */
export interface FollowPlaylist {
  id: number;
  name: string;
  shuffle: boolean;
  crossfadeSec: number;
  tracks: { id: number; title: string; url: string }[];
}

/** Zonenstand der folgenden Zone, solange sie folgt (statt ihres eigenen). */
export interface FollowView {
  sourceKind: "SILENCE" | "STREAM" | "PLAYLIST";
  streamUrl: string | null;
  playlist: FollowPlaylist | null;
}

export interface FollowerZone {
  id: number;
  accountId: number;
  volume: number;
  followState: string | null;
  followZone: FollowLeader | null;
}

/**
 * Gleicht eine folgende Zone beim Abruf ihres Abspielers ab und legt bei
 * Bedarf den Befehl an – vor dem Lesen der offenen Jobs, damit er im selben
 * Abruf mitgeht. Gibt den Zonenstand zurück, den der Abspieler statt des
 * eigenen bekommt, oder null (folgt nicht oder ist direkt gesteuert).
 * `window` ist das eigene Musikfenster der folgenden Zone (`followTarget`).
 */
export async function syncFollower(
  db: TenantDb,
  zone: FollowerZone,
  window: FollowWindow = { allowed: true }
): Promise<FollowView | null> {
  const leader = zone.followZone;
  if (!leader) return null;

  const target = followTarget(toLeaderState(leader), window);
  const step = followStep(zone.followState, target);
  if (step.hold) return null;

  const playlist =
    target.kind === "PLAYLIST"
      ? await db.audioPlaylist.findFirst({
          where: { id: target.playlistId, accountId: zone.accountId },
          include: playlistInclude,
        })
      : null;
  const tracks = (playlist?.items ?? [])
    .map((item) => item.track)
    .filter((track) => !!track.url);

  if (step.send) {
    // Nur ein Abruf darf den Wechsel weitergeben (Pi und Monitor fragen
    // parallel, ein Abruf kann doppelt kommen).
    const claimed = await db.audioZone.updateMany({
      where: { id: zone.id, followState: zone.followState },
      data: { followState: step.nextState },
    });
    if (claimed.count === 1) {
      const payload: Prisma.InputJsonValue | undefined =
        target.kind === "STREAM"
          ? { kind: "STREAM", url: target.url, volume: zone.volume, manual: window.manual === true }
          : target.kind === "PLAYLIST" && playlist && tracks.length > 0
            ? {
                kind: "PLAYLIST",
                playlistId: playlist.id,
                name: playlist.name,
                // Die Reihenfolge steht schon fest: Start beim Titel der gefolgten Zone.
                shuffle: false,
                crossfadeSec: playlist.crossfadeSec,
                tracks: followTrackOrder(tracks, leader.currentTitle, playlist.shuffle).map((track) => ({
                  id: track.id,
                  title: track.title,
                  url: track.url,
                })),
                volume: zone.volume,
                // Außerhalb des Fensters nur nach Start von Hand: der Abspieler
                // verwirft ein Play sonst, solange er das Fenster zu sieht.
                manual: window.manual === true,
              }
            : undefined;
      await db.audioJob.create({
        data: {
          accountId: zone.accountId,
          zoneId: zone.id,
          kind: payload ? "PLAY" : "STOP",
          triggerKind: FOLLOW_TRIGGER,
          payload,
        },
      });
    }
  }

  if (target.kind === "STREAM") {
    return { sourceKind: "STREAM", streamUrl: target.url, playlist: null };
  }
  if (target.kind === "PLAYLIST" && playlist && tracks.length > 0) {
    return {
      sourceKind: "PLAYLIST",
      streamUrl: null,
      playlist: {
        id: playlist.id,
        name: playlist.name,
        shuffle: playlist.shuffle,
        crossfadeSec: playlist.crossfadeSec,
        tracks: tracks.map((track) => ({ id: track.id, title: track.title, url: track.url })),
      },
    };
  }
  return { sourceKind: "SILENCE", streamUrl: null, playlist: null };
}

/**
 * Direkter Start/Stopp an Zonen, die folgen (Dashboard, Zeitplan, Regel,
 * Abstimmung): Der Abgleich hält still, bis sich die gefolgte Zone ändert.
 */
export async function holdFollowers(db: TenantDb, zoneIds: number[]): Promise<void> {
  if (zoneIds.length === 0) return;
  const followers = await db.audioZone.findMany({
    where: { id: { in: zoneIds }, followZoneId: { not: null } },
    select: { id: true, followZone: { select: followLeaderSelect } },
  });
  for (const follower of followers) {
    if (!follower.followZone) continue;
    await db.audioZone.update({
      where: { id: follower.id },
      data: { followState: holdState(leaderTarget(toLeaderState(follower.followZone))) },
    });
  }
}

/**
 * Start an einer folgenden Zone ohne eigene Quelle: wieder folgen. Spielt die
 * gefolgte Zone gerade nichts, gibt es nichts zu starten.
 */
export async function resumeFollowing(
  db: TenantDb,
  zone: { id: number; followZoneId: number },
  /** Läuft erst, wenn feststeht, dass es etwas zu starten gibt (Vorrang von Hand). */
  beforeResume?: () => Promise<void>
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const leader = await db.audioZone.findFirst({
    where: { id: zone.followZoneId },
    select: followLeaderSelect,
  });
  if (!leader) return { ok: false, error: "Gefolgte Zone nicht gefunden", status: 404 };
  if (leaderTarget(toLeaderState(leader)).kind === "STOP") {
    return {
      ok: false,
      error: `Folgt „${leader.name}“ – dort läuft gerade keine Musik`,
      status: 409,
    };
  }
  if (beforeResume) await beforeResume();
  await db.audioZone.update({ where: { id: zone.id }, data: { followState: null } });
  return { ok: true };
}

/**
 * Prüft die Wahl „Folgt Zone“. undefined = Feld nicht gesendet. Keine Ketten:
 * Die gefolgte Zone folgt selbst niemandem, und einer Zone, der andere folgen,
 * kann nicht selbst folgen.
 */
export async function resolveFollowZone(
  db: TenantDb,
  accountId: number,
  value: unknown,
  zoneId: number | null
): Promise<{ followZoneId: number | null } | { error: string; status: number } | undefined> {
  if (value === undefined) return undefined;
  if (value === null || value === "") return { followZoneId: null };
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) return { error: "Ungültige Zone", status: 400 };
  if (id === zoneId) return { error: "Eine Zone kann nicht sich selbst folgen", status: 400 };
  const leader = await db.audioZone.findFirst({
    where: { id, accountId },
    select: { id: true, name: true, followZoneId: true },
  });
  if (!leader) return { error: "Zone zum Folgen nicht gefunden", status: 404 };
  if (leader.followZoneId !== null) {
    return { error: `„${leader.name}“ folgt selbst einer Zone – bitte der Zone dort folgen`, status: 400 };
  }
  if (zoneId !== null) {
    const follower = await db.audioZone.findFirst({
      where: { followZoneId: zoneId, accountId },
      select: { name: true },
    });
    if (follower) {
      return {
        error: `„${follower.name}“ folgt dieser Zone – eine Zone, der andere folgen, kann nicht selbst folgen`,
        status: 400,
      };
    }
  }
  return { followZoneId: id };
}
