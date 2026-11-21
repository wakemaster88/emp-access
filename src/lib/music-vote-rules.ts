/**
 * Playlist-Abstimmung der Fahrer: reine Regeln ohne Datenbank, damit sie sich
 * prüfen lassen und auch im Browser (Kunden-App, Verwaltung) nutzbar sind.
 *
 * Aaron, 21.11.2026: „in der kunden app soll optional aktiviert werden können,
 * dass alle aktiven fahrer die playlist auswählen können. die mehrheit ist
 * immer aktiv“. Daraus:
 * - Abstimmen darf, wer heute am Lift gestartet ist. Die Stimme zählt, solange
 *   der letzte Start höchstens `VOTE_ACTIVE_MS` her ist („gerade da“).
 * - Je Person und Tag eine Stimme, jederzeit änderbar.
 * - Die Playlist mit den meisten Stimmen läuft. Bei Gleichstand bleibt die
 *   laufende, sonst gewinnt die weiter vorn in der Auswahl.
 * - Die Abstimmung startet nie selbst Musik und hält das Musikfenster ein:
 *   sie wechselt nur, was ohnehin läuft.
 * - Personal geht vor: nach Start/Stopp von Hand ruht sie für die eingestellte
 *   Zeit (`musicVoteHoldMinutes`).
 */

/** So lange nach dem letzten Start zählt eine Person als aktiv. */
export const VOTE_ACTIVE_MS = 2 * 60 * 60_000;
export const VOTE_ACTIVE_HOURS = VOTE_ACTIVE_MS / 3_600_000;
export const DEFAULT_HOLD_MINUTES = 60;
export const MAX_HOLD_MINUTES = 8 * 60;
/** Mehr Playlists machen die Karte in der App zu lang. */
export const MAX_VOTE_PLAYLISTS = 8;

export interface VoteOption {
  id: number;
  name: string;
}

export interface VoteTally {
  playlistId: number;
  name: string;
  votes: number;
}

/** Ist eine Person mit diesem letzten Start jetzt aktiv? */
export function isActiveRider(lastStartAt: Date | null | undefined, now: Date): boolean {
  if (!lastStartAt) return false;
  const age = now.getTime() - lastStartAt.getTime();
  return age >= -60_000 && age <= VOTE_ACTIVE_MS;
}

/**
 * Stimmen je Playlist zählen, in der Reihenfolge der Auswahl. Stimmen für
 * Playlists, die nicht mehr zur Wahl stehen, fallen weg.
 */
export function tallyVotes(options: VoteOption[], votes: { playlistId: number }[]): VoteTally[] {
  const counts = new Map<number, number>();
  for (const v of votes) counts.set(v.playlistId, (counts.get(v.playlistId) ?? 0) + 1);
  return options.map((o) => ({ playlistId: o.id, name: o.name, votes: counts.get(o.id) ?? 0 }));
}

/**
 * Mehrheit: meiste Stimmen. Gleichstand → die laufende bleibt, sonst die
 * weiter vorn in der Auswahl. Ohne eine einzige Stimme gibt es keinen
 * Gewinner (dann läuft, was das Personal eingestellt hat).
 */
export function pickWinner(tally: VoteTally[], currentPlaylistId: number | null): number | null {
  const top = Math.max(0, ...tally.map((t) => t.votes));
  if (top === 0) return null;
  const leaders = tally.filter((t) => t.votes === top);
  if (currentPlaylistId != null && leaders.some((t) => t.playlistId === currentPlaylistId)) return currentPlaylistId;
  return leaders[0].playlistId;
}

/** Bis wann ruht die Abstimmung nach einer Wahl des Personals? null = sie ruht nicht. */
export function staffHoldUntil(staffChoiceAt: Date | null | undefined, holdMinutes: number, now: Date): Date | null {
  if (!staffChoiceAt || holdMinutes <= 0) return null;
  const until = new Date(staffChoiceAt.getTime() + holdMinutes * 60_000);
  return until.getTime() > now.getTime() ? until : null;
}

export interface ZoneForVote {
  isActive: boolean;
  deviceId: number | null;
  isPlaying: boolean;
  externalActive: string | null;
  sourceKind: string;
  playlistId: number | null;
  staffChoiceAt: Date | null;
}

export type VoteDecision =
  | { kind: "switch"; playlistId: number }
  | { kind: "keep" }
  | { kind: "idle"; reason: "no-votes" | "not-playing" | "external" | "no-player" | "staff-hold" };

/**
 * Was die Abstimmung an einer Zone jetzt tut. Sie wechselt nur laufende Musik,
 * nie während AirPlay/Bluetooth übernommen hat und nie in der Ruhezeit nach
 * einer Wahl des Personals.
 */
export function decideZone(
  zone: ZoneForVote,
  winner: number | null,
  holdMinutes: number,
  now: Date,
): VoteDecision {
  if (!zone.isActive || zone.deviceId == null) return { kind: "idle", reason: "no-player" };
  if (staffHoldUntil(zone.staffChoiceAt, holdMinutes, now)) return { kind: "idle", reason: "staff-hold" };
  if (!zone.isPlaying) return { kind: "idle", reason: "not-playing" };
  if (zone.externalActive) return { kind: "idle", reason: "external" };
  if (winner == null) return { kind: "idle", reason: "no-votes" };
  if (zone.sourceKind === "PLAYLIST" && zone.playlistId === winner) return { kind: "keep" };
  return { kind: "switch", playlistId: winner };
}

/** Auswahl bereinigen: nur bekannte IDs, ohne Doppelte, Reihenfolge bleibt. */
export function cleanVoteIds(ids: number[], known: number[], max = MAX_VOTE_PLAYLISTS): number[] {
  const allowed = new Set(known);
  const out: number[] = [];
  for (const id of ids) if (allowed.has(id) && !out.includes(id)) out.push(id);
  return out.slice(0, max);
}

export function clampHoldMinutes(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_HOLD_MINUTES;
  return Math.min(MAX_HOLD_MINUTES, Math.max(0, n));
}

/** Was die Kunden-App zur Abstimmung zeigt. */
export interface MusicVoteView {
  /** Zonennamen, z. B. „Insel“. */
  where: string;
  options: VoteTally[];
  /** Eigene Stimme heute (nur wenn sie zählt oder die Person aktiv ist). */
  myPlaylistId: number | null;
  /** Darf die Person gerade abstimmen? */
  canVote: boolean;
  /** Playlist, die gerade läuft (null = keine Musik). */
  playingPlaylistId: number | null;
  playingName: string | null;
  /** Abstimmung ruht wegen einer Wahl des Personals bis … (ISO). */
  holdUntil: string | null;
  /** Aktive Fahrer mit Stimme. */
  voters: number;
}
