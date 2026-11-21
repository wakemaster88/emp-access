/**
 * Playlist-Abstimmung der Fahrer (Playlists und Webradio): reine Regeln ohne Datenbank, damit sie sich
 * prüfen lassen und auch im Browser (Kunden-App, Verwaltung) nutzbar sind.
 *
 * Aaron, 21.11.2026: „in der kunden app soll optional aktiviert werden können,
 * dass alle aktiven fahrer die playlist auswählen können. die mehrheit ist
 * immer aktiv“. Daraus:
 * - Abstimmen darf, wer heute am Lift gestartet ist. Die Stimme zählt, solange
 *   der letzte Start höchstens `VOTE_ACTIVE_MS` her ist („gerade da“).
 * - Je Person und Tag eine Stimme, jederzeit änderbar.
 * - Die Option (Playlist oder Webradio) mit den meisten Stimmen läuft. Bei Gleichstand bleibt die
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
/** Abstimmungsrunde: gewechselt wird am Rundenende (Aaron: Timer bis zum Wechsel). */
export const DEFAULT_ROUND_MINUTES = 15;
export const ROUND_CHOICES = [0, 5, 10, 15, 20, 30, 60] as const;

/**
 * Runde, in der `now` liegt. Runden zählen ab Mitternacht (Berlin), bei 15
 * also :00, :15, :30, :45. Die letzte Runde endet spätestens um Mitternacht.
 * 0 Minuten = keine Runden (Wechsel sofort): null.
 */
export function voteRound(now: Date, dayStart: Date, minutes: number): { start: Date; end: Date } | null {
  if (!(minutes > 0)) return null;
  const len = minutes * 60_000;
  const since = Math.max(0, now.getTime() - dayStart.getTime());
  const start = dayStart.getTime() + Math.floor(since / len) * len;
  const end = Math.min(start + len, dayStart.getTime() + 24 * 3_600_000);
  return { start: new Date(start), end: new Date(Math.max(end, start + 60_000)) };
}

/**
 * Ist jetzt eine Auswertung fällig? Mit Runden einmal je Rundenbeginn (die
 * gerade abgelaufene Runde wird ausgewertet), ohne Runden immer.
 */
export function roundDue(round: { start: Date } | null, lastRoundAt: Date | null): boolean {
  if (!round) return true;
  return !lastRoundAt || lastRoundAt.getTime() < round.start.getTime();
}
/** Mehr Auswahl macht die Karte in der App zu lang. */
export const MAX_VOTE_OPTIONS = 8;

/**
 * Eine Option ist eine Playlist ("p<id>") oder ein Webradio-Sender ("s<id>").
 * Als Text, damit beide Arten in einer Liste und einer Stimme Platz haben.
 */
export type VoteKind = "PLAYLIST" | "STREAM";

export function optionKey(kind: VoteKind, id: number): string {
  return `${kind === "PLAYLIST" ? "p" : "s"}${id}`;
}

export function parseOptionKey(key: string): { kind: VoteKind; id: number } | null {
  const m = /^([ps])([1-9]\d{0,9})$/.exec(key);
  if (!m) return null;
  return { kind: m[1] === "p" ? "PLAYLIST" : "STREAM", id: Number(m[2]) };
}

export interface VoteOption {
  key: string;
  name: string;
}

export interface VoteTally {
  key: string;
  kind: VoteKind;
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
export function tallyVotes(options: VoteOption[], votes: { option: string }[]): VoteTally[] {
  const counts = new Map<string, number>();
  for (const v of votes) counts.set(v.option, (counts.get(v.option) ?? 0) + 1);
  return options.map((o) => ({
    key: o.key,
    kind: o.key.startsWith("s") ? "STREAM" : "PLAYLIST",
    name: o.name,
    votes: counts.get(o.key) ?? 0,
  }));
}

/**
 * Mehrheit: meiste Stimmen. Gleichstand → die laufende bleibt, sonst die
 * weiter vorn in der Auswahl. Ohne eine einzige Stimme gibt es keinen
 * Gewinner (dann läuft, was das Personal eingestellt hat).
 */
export function pickWinner(tally: VoteTally[], current: string | null): string | null {
  const top = Math.max(0, ...tally.map((t) => t.votes));
  if (top === 0) return null;
  const leaders = tally.filter((t) => t.votes === top);
  if (current != null && leaders.some((t) => t.key === current)) return current;
  return leaders[0].key;
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
  streamId: number | null;
  staffChoiceAt: Date | null;
  /** Musik-Skill eines Fahrers läuft bis hier (lib/rider-skills). */
  riderChoiceUntil?: Date | null;
}

/** Was in der Zone gerade läuft, als Option ("p…"/"s…"); null = nichts Wählbares. */
export function currentOption(zone: Pick<ZoneForVote, "isPlaying" | "sourceKind" | "playlistId" | "streamId">): string | null {
  if (!zone.isPlaying) return null;
  if (zone.sourceKind === "PLAYLIST" && zone.playlistId != null) return optionKey("PLAYLIST", zone.playlistId);
  if (zone.sourceKind === "STREAM" && zone.streamId != null) return optionKey("STREAM", zone.streamId);
  return null;
}

export type VoteDecision =
  | { kind: "switch"; option: string }
  | { kind: "keep" }
  | { kind: "idle"; reason: "no-votes" | "not-playing" | "external" | "no-player" | "staff-hold" | "rider-skill" };

/**
 * Was die Abstimmung an einer Zone jetzt tut. Sie wechselt nur laufende Musik,
 * nie während AirPlay/Bluetooth übernommen hat und nie in der Ruhezeit nach
 * einer Wahl des Personals.
 */
export function decideZone(
  zone: ZoneForVote,
  winner: string | null,
  holdMinutes: number,
  now: Date,
): VoteDecision {
  if (!zone.isActive || zone.deviceId == null) return { kind: "idle", reason: "no-player" };
  if (staffHoldUntil(zone.staffChoiceAt, holdMinutes, now)) return { kind: "idle", reason: "staff-hold" };
  if (zone.riderChoiceUntil && zone.riderChoiceUntil > now) return { kind: "idle", reason: "rider-skill" };
  if (!zone.isPlaying) return { kind: "idle", reason: "not-playing" };
  if (zone.externalActive) return { kind: "idle", reason: "external" };
  if (winner == null) return { kind: "idle", reason: "no-votes" };
  if (currentOption(zone) === winner) return { kind: "keep" };
  return { kind: "switch", option: winner };
}

/** Auswahl bereinigen: nur bekannte Einträge, ohne Doppelte, Reihenfolge bleibt. */
export function cleanVoteIds<T extends number | string>(ids: T[], known: T[], max = MAX_VOTE_OPTIONS): T[] {
  const allowed = new Set(known);
  const out: T[] = [];
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
  /** Eigene Stimme heute ("p…"/"s…"). */
  myOption: string | null;
  /** Darf die Person gerade abstimmen? */
  canVote: boolean;
  /** Option, die gerade läuft (null = keine Musik oder nichts aus der Auswahl). */
  playingOption: string | null;
  playingName: string | null;
  /** Abstimmung ruht wegen einer Wahl des Personals bis … (ISO). */
  holdUntil: string | null;
  /** Wer gerade gewählt hat: das Team oder ein Fahrer mit Musik-Skill. */
  holdBy?: "staff" | "rider" | null;
  /** Nächster Wechsel (Ende der laufenden Runde, ISO); null = sofort nach jeder Stimme. */
  nextSwitchAt: string | null;
  /** Aktive Fahrer mit Stimme. */
  voters: number;
}
