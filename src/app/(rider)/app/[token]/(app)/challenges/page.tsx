import { riderBase } from "@/lib/rider-base";
import Link from "next/link";
import { findRiderAuthProfileCached, requireRider, riderFamilyView } from "@/lib/rider-auth";
import { mayVote } from "@/lib/challenge-voting";
import { RiderChallengeVoting } from "@/components/rider/rider-challenge-voting";
import { loadRiderChallengesCached, type RiderChallenge } from "@/lib/rider-challenges";
import { METRIC_LABEL } from "@/lib/gamification";
import { ChallengePrize, challengeTimeText as timeText } from "@/components/rider/rider-challenge-parts";

export const dynamic = "force-dynamic";

interface Viewer {
  token: string;
  canVote: boolean;
  canUpload: boolean;
  /** Warum nicht abgestimmt werden kann (wenn `canVote` aus ist). */
  noVoteText: string;
  /** Name der angezeigten Person, wenn Eltern oder Partner sie ansehen; sonst null („Du“). */
  shownName: string | null;
}

/** In der Familienansicht steht statt „Du“ der Name der angezeigten Person. */
function asShown(c: RiderChallenge, name: string | null): RiderChallenge {
  if (!name) return c;
  return {
    ...c,
    top: c.top.map((t) => (t.me ? { ...t, name } : t)),
    voting: c.voting && { ...c.voting, entries: c.voting.entries.map((e) => (e.mine ? { ...e, name } : e)) },
  };
}

function ChallengeCard({ c, viewer }: { c: RiderChallenge; viewer: Viewer }) {
  const metric = METRIC_LABEL[c.metric];
  return (
    <div className="rd-card" style={{ gap: 10 }}>
      <div className="rd-card-head">
        {c.won ? (
          <span className="rd-pill rd-pill-win">{c.kind === "TASK" ? "geschafft" : "gewonnen"}</span>
        ) : c.kind === "POLL" && c.voting?.myVoted && c.phase === "running" ? (
          <span className="rd-pill rd-pill-open">abgestimmt · {timeText(c)}</span>
        ) : (
          <span className={`rd-pill ${c.phase === "running" ? "rd-pill-open" : "rd-pill-off"}`}>{timeText(c)}</span>
        )}
        <div className="rd-display rd-h2">{c.name}</div>
      </div>
      {c.description && <div className="rd-soft">{c.description}</div>}
      <ChallengePrize c={c} />

      {c.kind === "TASK" && c.phase !== "upcoming" && c.threshold != null && (
        <>
          <div className="rd-bar" role="img" aria-label={`${Math.min(c.value, c.threshold)} von ${c.threshold} ${metric}`}>
            <i style={{ width: `${Math.min(100, Math.round((c.value / c.threshold) * 100))}%` }} />
          </div>
          <div className="rd-between">
            <b>{Math.min(c.value, c.threshold)} von {c.threshold} {metric}</b>
            {c.won && c.phase === "running" && <span className="rd-muted">{timeText(c)}</span>}
          </div>
        </>
      )}

      {c.kind === "TOP_X" && c.phase !== "upcoming" && (
        <>
          <div className="rd-between">
            <b>
              {viewer.shownName
                ? c.rank != null ? `${viewer.shownName} ist auf Platz ${c.rank} · ${c.value} ${metric}` : `${viewer.shownName} ist noch nicht dabei`
                : c.rank != null ? `Du bist auf Platz ${c.rank} · ${c.value} ${metric}` : "Du bist noch nicht dabei"}
            </b>
            <span className="rd-muted">{c.participants} Fahrer dabei</span>
          </div>
          {c.top.length > 0 && (
            <div className="rd-rank">
              {c.top.map((t, i) => (
                <div key={i} className={t.me ? "rd-rank-me" : undefined}>
                  <span className="rd-pos">{t.rank}</span>
                  <span className="rd-grow">{t.name}</span>
                  <span>{t.value}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {(c.kind === "PHOTO" || c.kind === "POLL") && c.voting && c.phase !== "upcoming" && (
        <RiderChallengeVoting
          token={viewer.token}
          challengeId={c.id}
          kind={c.kind}
          running={c.phase === "running"}
          ended={c.phase === "ended"}
          voting={c.voting}
          canVote={viewer.canVote}
          canUpload={viewer.canUpload}
          noVoteText={viewer.noVoteText}
        />
      )}
    </div>
  );
}

/** Challenges: laufende zuerst, dann kommende und kürzlich beendete. */
export default async function RiderChallenges({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const rider = await requireRider(token);
  const [loaded, family] = await Promise.all([loadRiderChallengesCached(rider), riderFamilyView(token)]);
  const self = family?.relation === "self";
  const profile = self ? await findRiderAuthProfileCached(token) : null;
  const eligible = profile ? await mayVote(profile) : false;
  const viewer: Viewer = {
    token,
    canVote: self && eligible,
    canUpload: family?.relation !== "view" && rider.ticketIds.length > 0,
    noVoteText: self ? "Abstimmen kann, wer ein Abo oder Ticket hat." : "Abstimmen kann jede Person nur selbst, in ihrem eigenen Zugang.",
    shownName: family && !self ? rider.firstName || null : null,
  };
  const challenges = loaded.map((c) => asShown(c, viewer.shownName));
  const running = challenges.filter((c) => c.phase === "running");
  const upcoming = challenges.filter((c) => c.phase === "upcoming");
  const ended = challenges.filter((c) => c.phase === "ended");
  const anonymous = !rider.showInRanking || !rider.nickname;

  return (
    <>
      <h1 className="rd-display rd-h1">Challenges</h1>
      {challenges.length === 0 && (
        <div className="rd-card rd-muted">Gerade läuft keine Challenge. Schau bald wieder vorbei.</div>
      )}
      {running.map((c) => <ChallengeCard key={c.id} c={c} viewer={viewer} />)}
      {upcoming.length > 0 && <div className="rd-label" style={{ marginTop: 4 }}>Demnächst</div>}
      {upcoming.map((c) => <ChallengeCard key={c.id} c={c} viewer={viewer} />)}
      {ended.length > 0 && <div className="rd-label" style={{ marginTop: 4 }}>Beendet</div>}
      {ended.map((c) => <ChallengeCard key={c.id} c={c} viewer={viewer} />)}
      {challenges.some((c) => c.kind === "TOP_X" || c.kind === "PHOTO") && anonymous && (
        <div className="rd-card rd-muted">
          <p style={{ margin: 0 }}>
            In Ranglisten und an deinen Fotos stehst du für andere als „Anonym“. Mit Spitzname und Zustimmung im{" "}
            <Link href={`${(await riderBase(token))}/profil`}>Profil</Link> erscheinst du mit Spitznamen.
          </p>
        </div>
      )}
    </>
  );
}
