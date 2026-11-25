/**
 * Foto-Challenges und Abstimmungen in der Kunden-App: Fotos hochladen,
 * abstimmen und den Stand für eine Person laden.
 *
 * Regeln (Claude, 21.11.2026, Aaron: „challenges erweitern mit abstimmungen“
 * und „… mit bild upload“):
 * - Hochladen und Abstimmen nur, solange die Challenge läuft (Start- und
 *   Endtag eingeschlossen). Ein Foto je Person; ein neues ersetzt das alte,
 *   seine Stimmen verfallen dann.
 * - Eine Stimme je Person und Challenge, bis zum Ende änderbar. Nicht für das
 *   eigene Foto.
 * - Foto-Challenge: Stimmenzahlen erst nach dem Ende, damit niemand dem
 *   Vorne-Liegenden folgt. Abstimmung: das Ergebnis sieht, wer abgestimmt hat.
 * - Für andere steht am Foto nur der Spitzname mit Zustimmung, sonst „Anonym“.
 * - Ausgeblendete Fotos (Personal) sieht nur die Person selbst; sie zählen nicht.
 */
import { prisma, tenantClient } from "./prisma";
import { deleteBlobs, resolveBinary, storeBlob } from "./blob-store";
import { challengeOver, rankStandings, type ChallengeKind, type ChallengePhase } from "./gamification";
import { berlinHm } from "./berlin-day";
import { decodePhotoDataUrl, pollPercents, seededOrder } from "./challenge-voting-rules";
import { encodeChallengePhoto, encodeChallengeThumb } from "./challenge-photo-encode";

export interface PhotoEntryView {
  id: number;
  name: string;
  mine: boolean;
  /** Nur nach dem Ende (bzw. für das Personal). */
  votes: number | null;
  rank: number | null;
  winner: boolean;
  /** Die Person hat für dieses Foto gestimmt. */
  voted: boolean;
  hidden: boolean;
}

export interface PollOptionView {
  id: number;
  label: string;
  /** Nur mit sichtbarem Ergebnis. */
  votes: number | null;
  percent: number | null;
  voted: boolean;
}

export interface VotingView {
  entries: PhotoEntryView[];
  myEntry: { id: number; hidden: boolean } | null;
  options: PollOptionView[];
  totalVotes: number;
  /** Die Person hat in dieser Challenge schon abgestimmt. */
  myVoted: boolean;
  showResults: boolean;
}

interface VotingChallenge {
  id: number;
  kind: ChallengeKind;
  phase: ChallengePhase;
  topCount: number | null;
}

/** Stand der Foto-Challenges und Abstimmungen für eine Person (oder das Personal mit `staff`). */
export async function loadVoting(
  accountId: number,
  challenges: VotingChallenge[],
  profileId: number | null,
  staff = false,
  /** Andere Mitglieder der eigenen Familie: stehen mit Namen statt „Anonym“ da. */
  familyNames: Map<number, string> = new Map(),
): Promise<Map<number, VotingView>> {
  const out = new Map<number, VotingView>();
  const voting = challenges.filter((c) => c.kind === "PHOTO" || c.kind === "POLL");
  if (voting.length === 0) return out;
  const ids = voting.map((c) => c.id);

  const [entries, options, votes] = await Promise.all([
    prisma.challengeEntry.findMany({
      where: { accountId, challengeId: { in: ids } },
      select: {
        id: true, challengeId: true, profileId: true, hidden: true, createdAt: true,
        profile: { select: { nickname: true, showInRanking: true, firstName: true, lastName: true } },
        _count: { select: { votes: true } },
      },
    }),
    prisma.challengeOption.findMany({
      where: { accountId, challengeId: { in: ids } },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: { id: true, challengeId: true, label: true, _count: { select: { votes: true } } },
    }),
    profileId != null
      ? prisma.challengeVote.findMany({
          where: { accountId, challengeId: { in: ids }, profileId },
          select: { challengeId: true, entryId: true, optionId: true },
        })
      : Promise.resolve([]),
  ]);
  const myVotes = new Map(votes.map((v) => [v.challengeId, v]));

  for (const c of voting) {
    const mine = myVotes.get(c.id);
    const ended = c.phase === "ended";
    if (c.kind === "POLL") {
      const opts = options.filter((o) => o.challengeId === c.id);
      const counts = opts.map((o) => o._count.votes);
      const total = counts.reduce((a, b) => a + b, 0);
      const showResults = staff || ended || mine != null;
      const percents = pollPercents(counts);
      out.set(c.id, {
        entries: [],
        myEntry: null,
        options: opts.map((o, i) => ({
          id: o.id,
          label: o.label,
          votes: showResults ? counts[i] : null,
          percent: showResults ? percents[i] : null,
          voted: mine?.optionId === o.id,
        })),
        totalVotes: total,
        myVoted: mine != null,
        showResults,
      });
      continue;
    }

    const all = entries.filter((e) => e.challengeId === c.id);
    const visible = all.filter((e) => !e.hidden);
    const standings = rankStandings(visible.map((e) => ({ key: e.id, value: e._count.votes })), c.topCount ?? 1);
    const byEntry = new Map(standings.map((s) => [s.key, s]));
    const showResults = staff || ended;
    const shown = all.filter((e) => staff || !e.hidden || e.profileId === profileId);
    const view = shown.map((e): PhotoEntryView & { order: number } => {
      const s = byEntry.get(e.id);
      const isMine = e.profileId === profileId;
      const p = e.profile;
      const name = staff
        ? [p.firstName, p.lastName].filter(Boolean).join(" ") || p.nickname || `Profil ${e.profileId}`
        : isMine ? "Du" : familyNames.get(e.profileId) ?? ((p.showInRanking && p.nickname) || "Anonym");
      return {
        id: e.id,
        name,
        mine: isMine,
        votes: showResults ? e._count.votes : null,
        rank: showResults ? s?.rank ?? null : null,
        winner: showResults && ended && !!s?.winner,
        voted: mine?.entryId === e.id,
        hidden: e.hidden,
        order: e._count.votes,
      };
    });
    const ordered = showResults
      ? view.sort((a, b) => b.order - a.order || a.id - b.id)
      : [...view.filter((v) => v.mine), ...seededOrder(view.filter((v) => !v.mine), profileId ?? 0)];
    const own = all.find((e) => e.profileId === profileId);
    out.set(c.id, {
      entries: ordered.map((v) => ({ id: v.id, name: v.name, mine: v.mine, votes: v.votes, rank: v.rank, winner: v.winner, voted: v.voted, hidden: v.hidden })),
      myEntry: own ? { id: own.id, hidden: own.hidden } : null,
      options: [],
      totalVotes: visible.reduce((a, e) => a + e._count.votes, 0),
      myVoted: mine != null,
      showResults,
    });
  }
  return out;
}

type Fail = { error: string; status: number };

/** Laufende Challenge der Art `kind` im Konto, sonst ein Fehler. */
async function runningChallenge(
  accountId: number,
  challengeId: number,
  kind: ChallengeKind,
  todayYmd: string,
): Promise<Fail | { challenge: { id: number } }> {
  const c = await prisma.challenge.findFirst({
    where: { id: challengeId, accountId, active: true, kind },
    select: { id: true, startDate: true, endDate: true, endTime: true },
  });
  if (!c) return { error: "Diese Challenge gibt es nicht mehr.", status: 404 };
  const start = c.startDate.toISOString().slice(0, 10);
  const end = c.endDate.toISOString().slice(0, 10);
  if (todayYmd < start) return { error: "Die Challenge hat noch nicht begonnen.", status: 409 };
  if (challengeOver({ endYmd: end, endTime: c.endTime }, todayYmd, berlinHm())) {
    return { error: "Die Challenge ist schon zu Ende.", status: 409 };
  }
  return { challenge: c };
}

/**
 * Darf diese Person abstimmen? Nur wer ein Abo oder Ticket hat, ein
 * Kundenkonto (Kauf bei anny) oder zu einer Familie mit Abo gehört. Sonst
 * könnte jede neue Mail-Adresse eine Stimme mehr abgeben, denn die App lässt
 * sich auch ohne Abo einrichten.
 */
export async function mayVote(p: { id: number; accountId: number; customerId: number | null; familyId: number | null }): Promise<boolean> {
  if (p.customerId != null) return true;
  const ticket = await prisma.ticket.findFirst({
    where: {
      accountId: p.accountId,
      OR: [{ riderProfileId: p.id }, ...(p.familyId != null ? [{ riderProfile: { familyId: p.familyId } }] : [])],
    },
    select: { id: true },
  });
  return ticket != null;
}

/**
 * Stimme abgeben oder ändern: für ein Foto (`entryId`) oder eine Antwort
 * (`optionId`). `null` für beides nimmt die Stimme zurück.
 */
export async function castVote(
  accountId: number,
  challengeId: number,
  profileId: number,
  target: { entryId?: number | null; optionId?: number | null },
  todayYmd: string,
): Promise<{ ok: true } | Fail> {
  const db = tenantClient(accountId);
  const entryId = target.entryId ?? null;
  const optionId = target.optionId ?? null;
  const kind: ChallengeKind = optionId != null ? "POLL" : "PHOTO";
  if (entryId == null && optionId == null) {
    const c = await prisma.challenge.findFirst({ where: { id: challengeId, accountId }, select: { kind: true } });
    if (!c) return { error: "Diese Challenge gibt es nicht mehr.", status: 404 };
    const run = await runningChallenge(accountId, challengeId, c.kind as ChallengeKind, todayYmd);
    if ("error" in run) return { error: run.error, status: run.status };
    await db.challengeVote.deleteMany({ where: { accountId, challengeId, profileId } });
    return { ok: true };
  }
  const run = await runningChallenge(accountId, challengeId, kind, todayYmd);
  if ("error" in run) return { error: run.error, status: run.status };

  if (entryId != null) {
    const entry = await db.challengeEntry.findFirst({
      where: { id: entryId, accountId, challengeId },
      select: { profileId: true, hidden: true },
    });
    if (!entry || entry.hidden) return { error: "Dieses Foto gibt es nicht mehr.", status: 404 };
    if (entry.profileId === profileId) return { error: "Für dein eigenes Foto kannst du nicht stimmen.", status: 409 };
  } else {
    const option = await db.challengeOption.findFirst({ where: { id: optionId!, accountId, challengeId }, select: { id: true } });
    if (!option) return { error: "Diese Antwort gibt es nicht mehr.", status: 404 };
  }
  await db.challengeVote.upsert({
    where: { challengeId_profileId: { challengeId, profileId } },
    create: { challengeId, profileId, entryId, optionId, accountId },
    update: { entryId, optionId },
  });
  return { ok: true };
}

/**
 * Foto hochladen (Data-URL, schon geprüft). Ersetzt ein früheres Foto der
 * Person; dessen Stimmen verfallen.
 */
export async function saveEntry(
  accountId: number,
  challengeId: number,
  profileId: number,
  dataUrl: string,
  todayYmd: string,
): Promise<{ ok: true; id: number } | Fail> {
  const run = await runningChallenge(accountId, challengeId, "PHOTO", todayYmd);
  if ("error" in run) return { error: run.error, status: run.status };
  const decoded = decodePhotoDataUrl(dataUrl);
  if (!decoded) return { error: "Bitte ein Foto als JPG oder PNG wählen.", status: 400 };

  // Gespeichert wird nur das neu kodierte Foto (JPEG, ohne Metadaten), nie die hochgeladene Datei.
  const photo = await encodeChallengePhoto(decoded.bytes);
  if (!photo) {
    return { error: "Dieses Foto konnte nicht verarbeitet werden. Bitte ein anderes Foto wählen.", status: 400 };
  }

  // Vorschaubild rechnet der Server aus dem geprüften Foto; klappt das nicht, zeigt die App das Foto selbst.
  const thumb = await encodeChallengeThumb(photo.bytes);

  const db = tenantClient(accountId);
  const blob = await storeBlob("challenge-photos", accountId, photo.bytes, photo.contentType, photo.ext);
  const thumbBlob = thumb ? await storeBlob("challenge-photos", accountId, thumb.bytes, thumb.contentType, thumb.ext) : null;
  const old = await db.challengeEntry.findFirst({
    where: { accountId, challengeId, profileId },
    select: { id: true, imageBlob: true, thumbBlob: true },
  });
  const created = await db.$transaction(async (tx) => {
    if (old) await tx.challengeEntry.delete({ where: { id: old.id } });
    return tx.challengeEntry.create({
      data: {
        challengeId,
        profileId,
        accountId,
        ...(blob ? { imageBlob: blob } : { image: photo.bytes }),
        ...(thumb ? (thumbBlob ? { thumbBlob } : { thumb: thumb.bytes }) : {}),
      },
      select: { id: true },
    });
  });
  if (old) await deleteBlobs([old.imageBlob, old.thumbBlob]);
  return { ok: true, id: created.id };
}

/** Eigenes Foto zurückziehen, solange die Challenge läuft. */
export async function removeEntry(
  accountId: number,
  challengeId: number,
  profileId: number,
  todayYmd: string,
): Promise<{ ok: true } | Fail> {
  const run = await runningChallenge(accountId, challengeId, "PHOTO", todayYmd);
  if ("error" in run) return { error: run.error, status: run.status };
  const db = tenantClient(accountId);
  const old = await db.challengeEntry.findFirst({
    where: { accountId, challengeId, profileId },
    select: { id: true, imageBlob: true, thumbBlob: true },
  });
  if (!old) return { ok: true };
  await db.challengeEntry.delete({ where: { id: old.id } });
  await deleteBlobs([old.imageBlob, old.thumbBlob]);
  return { ok: true };
}

/** Bytes eines Fotos (Blob oder Spalte) oder null. */
export async function entryImage(entry: { imageBlob: string | null; image: Uint8Array | null }): Promise<Buffer | null> {
  return resolveBinary({ blob: entry.imageBlob, bytes: entry.image });
}

/** Vorschaubild, sonst das Foto selbst (ältere Fotos haben keins). */
export async function entryThumb(entry: {
  imageBlob: string | null;
  image: Uint8Array | null;
  thumbBlob: string | null;
  thumb: Uint8Array | null;
}): Promise<Buffer | null> {
  if (entry.thumbBlob || entry.thumb) {
    const t = await resolveBinary({ blob: entry.thumbBlob, bytes: entry.thumb });
    if (t) return t;
  }
  return entryImage(entry);
}
