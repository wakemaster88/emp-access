import { riderBase } from "@/lib/rider-base";
import Link from "next/link";
import { Gift } from "lucide-react";
import { requireRider, riderFamilyView } from "@/lib/rider-auth";
import { RiderChallengeVoting } from "@/components/rider/rider-challenge-voting";
import { loadRiderChallengesCached, type RiderChallenge } from "@/lib/rider-challenges";
import { METRIC_LABEL } from "@/lib/gamification";
import { daysUntil, fmtDay } from "@/lib/rider-format";
import { clockText } from "@/lib/rider-announce-rules";

export const dynamic = "force-dynamic";

function timeText(c: RiderChallenge): string {
  const until = c.endTime ? ` bis ${clockText(c.endTime)}` : "";
  if (c.phase === "upcoming") {
    return c.endTime && c.startDate.getTime() === c.endDate.getTime()
      ? `am ${fmtDay(c.startDate)}${until}`
      : `startet am ${fmtDay(c.startDate)}`;
  }
  if (c.phase === "ended") return `beendet am ${fmtDay(c.endDate)}`;
  // Der Endtag zählt mit: bis zum Ende des Tages.
  const days = daysUntil(new Date(c.endDate.getTime() + 86_400_000));
  if (days <= 1) return c.endTime ? `heute${until}` : "endet heute";
  return `noch ${days} Tage`;
}

function ruleText(c: RiderChallenge): string {
  const metric = METRIC_LABEL[c.metric];
  switch (c.kind) {
    case "TASK":
      return `Aufgabe: ${c.condition}`;
    case "TOP_X":
      return (c.topCount ?? 1) <= 1
        ? `Platz 1 nach ${metric} gewinnt`
        : `Die besten ${c.topCount} nach ${metric} gewinnen`;
    case "PHOTO":
      return (c.topCount ?? 1) === 1
        ? "Foto-Challenge: das Foto mit den meisten Stimmen gewinnt"
        : `Foto-Challenge: die ${c.topCount} Fotos mit den meisten Stimmen gewinnen`;
    case "POLL":
      return "Abstimmung: eine Stimme pro Person";
  }
}

interface Viewer {
  token: string;
  canVote: boolean;
  canUpload: boolean;
}

function ChallengeCard({ c, viewer }: { c: RiderChallenge; viewer: Viewer }) {
  const metric = METRIC_LABEL[c.metric];
  return (
    <div className="rd-card" style={{ gap: 10 }}>
      <div className="rd-between" style={{ alignItems: "flex-start" }}>
        <div className="rd-display rd-h2">{c.name}</div>
        {c.won ? (
          <span className="rd-pill rd-pill-win">{c.kind === "TASK" ? "geschafft" : "gewonnen"}</span>
        ) : c.kind === "POLL" && c.voting?.myVoted && c.phase === "running" ? (
          <span className="rd-pill rd-pill-open">abgestimmt · {timeText(c)}</span>
        ) : (
          <span className={`rd-pill ${c.phase === "running" ? "rd-pill-open" : "rd-pill-off"}`}>{timeText(c)}</span>
        )}
      </div>
      {c.description && <div className="rd-soft">{c.description}</div>}
      {c.voucherLabel || c.skillLabel ? (
        <div className="rd-prize">
          <Gift className="rd-prize-icon" aria-hidden />
          <div className="rd-grow">
            <div className="rd-label">{c.won ? "Dein Gewinn" : "Gewinn"}</div>
            {c.voucherLabel && <b>{c.voucherLabel}</b>}
            {c.skillLabel && <b>Skill: {c.skillLabel}</b>}
            <div className="rd-muted">{ruleText(c)}</div>
          </div>
        </div>
      ) : (
        <div className="rd-muted">{ruleText(c)}</div>
      )}

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
              {c.rank != null ? `Du bist auf Platz ${c.rank} · ${c.value} ${metric}` : "Du bist noch nicht dabei"}
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
        />
      )}
    </div>
  );
}

/** Challenges: laufende zuerst, dann kommende und kürzlich beendete. */
export default async function RiderChallenges({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const rider = await requireRider(token);
  const [challenges, family] = await Promise.all([loadRiderChallengesCached(rider), riderFamilyView(token)]);
  const viewer: Viewer = { token, canVote: family?.relation === "self", canUpload: family?.relation !== "view" && rider.ticketIds.length > 0 };
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
