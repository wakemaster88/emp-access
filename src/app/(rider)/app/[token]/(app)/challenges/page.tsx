import { riderBase } from "@/lib/rider-base";
import Link from "next/link";
import { requireRider } from "@/lib/rider-auth";
import { loadRiderChallengesCached, type RiderChallenge } from "@/lib/rider-challenges";
import { METRIC_LABEL } from "@/lib/gamification";
import { daysUntil, fmtDay } from "@/lib/rider-format";

export const dynamic = "force-dynamic";

function timeText(c: RiderChallenge): string {
  if (c.phase === "upcoming") return `startet am ${fmtDay(c.startDate)}`;
  if (c.phase === "ended") return `beendet am ${fmtDay(c.endDate)}`;
  // Der Endtag zählt mit: bis zum Ende des Tages.
  const days = daysUntil(new Date(c.endDate.getTime() + 86_400_000));
  return days <= 1 ? "endet heute" : `noch ${days} Tage`;
}

/** „Platz 1 nach Starts gewinnt“ / „Die besten 3 nach Starts gewinnen“. */
function topText(topCount: number | null, metric: string): string {
  const n = topCount ?? 1;
  return n <= 1 ? `Platz 1 nach ${metric} gewinnt` : `Die besten ${n} nach ${metric} gewinnen`;
}

function ChallengeCard({ c }: { c: RiderChallenge }) {
  const metric = METRIC_LABEL[c.metric];
  return (
    <div className="rd-card" style={{ gap: 10 }}>
      <div className="rd-between" style={{ alignItems: "flex-start" }}>
        <div className="rd-display rd-h2">{c.name}</div>
        {c.won ? (
          <span className="rd-pill rd-pill-win">{c.kind === "TASK" ? "geschafft" : "gewonnen"}</span>
        ) : (
          <span className={`rd-pill ${c.phase === "running" ? "rd-pill-open" : "rd-pill-off"}`}>{timeText(c)}</span>
        )}
      </div>
      {c.description && <div className="rd-soft">{c.description}</div>}
      <div className="rd-muted">
        {c.kind === "TASK" ? `Aufgabe: ${c.condition}` : topText(c.topCount, metric)}
        {c.voucherLabel ? ` · Gewinn: ${c.voucherLabel}` : ""}
        {c.skillLabel ? ` · Skill: ${c.skillLabel}` : ""}
      </div>

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
    </div>
  );
}

/** Challenges: laufende zuerst, dann kommende und kürzlich beendete. */
export default async function RiderChallenges({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const rider = await requireRider(token);
  const challenges = await loadRiderChallengesCached(rider);
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
      {running.map((c) => <ChallengeCard key={c.id} c={c} />)}
      {upcoming.length > 0 && <div className="rd-label" style={{ marginTop: 4 }}>Demnächst</div>}
      {upcoming.map((c) => <ChallengeCard key={c.id} c={c} />)}
      {ended.length > 0 && <div className="rd-label" style={{ marginTop: 4 }}>Beendet</div>}
      {ended.map((c) => <ChallengeCard key={c.id} c={c} />)}
      {challenges.some((c) => c.kind === "TOP_X") && anonymous && (
        <div className="rd-card rd-muted">
          <p style={{ margin: 0 }}>
            In Ranglisten stehst du für andere als „Anonym“. Mit Spitzname und Zustimmung im{" "}
            <Link href={`${(await riderBase(token))}/profil`}>Profil</Link> erscheinst du mit Spitznamen.
          </p>
        </div>
      )}
    </>
  );
}
