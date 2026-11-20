import Link from "next/link";
import { notFound } from "next/navigation";
import { AwardBadge } from "@/components/rider/award-badge";
import { GiftIcon, LockIcon, TierTag } from "@/components/rider/award-parts";
import { RiderShare } from "@/components/rider/rider-share";
import { CATEGORY_LABEL, awardFace, awardRemainingText, awardUnit, tierRank } from "@/lib/awards";
import { riderAppPath } from "@/lib/rider-app";
import { requireRider } from "@/lib/rider-auth";
import { fmtDay, validityText } from "@/lib/rider-format";
import { RIDER_LOCATION } from "@/lib/rider-shop";

export const dynamic = "force-dynamic";

const fmt = (n: number) => n.toLocaleString("de-DE");

/** Ein Award groß: Abzeichen, Stand, Gutschein und die Reihe, zu der er gehört. */
export default async function RiderAwardDetail({ params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  const rider = await requireRider(token);
  const a = rider.awards.find((x) => x.id === Number(id));
  if (!a) notFound();
  const base = riderAppPath(token);
  const countable = a.metric !== "EVENT_DAYS" && a.threshold > 0;
  // Die Reihe: gleiche Zählart im gleichen Zeitraum, vom kleinsten zum größten Ziel.
  const ladder = rider.awards
    .filter((x) => x.metric === a.metric && x.period === a.period)
    .sort((x, y) => x.threshold - y.threshold || tierRank(x.tier) - tierRank(y.tier));
  const v = a.voucher;

  return (
    <>
      <div className="rd-aw-top">
        <Link href={`${base}/awards`}>
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
          Awards
        </Link>
        <span className="rd-label">{CATEGORY_LABEL[a.category]}</span>
        {a.unlocked ? (
          <RiderShare title={a.name} text={`Award freigeschaltet: ${a.name} am ${RIDER_LOCATION}.`} />
        ) : (
          <span aria-hidden="true" style={{ width: 56 }} />
        )}
      </div>

      <div className="rd-aw-stage">
        <span className={a.unlocked ? undefined : "rd-aw-tease rd-aw-tease-big"}>
          <AwardBadge award={a} size={208} />
        </span>
        <span className="rd-aw-lockchip">
          {a.unlocked ? `Freigeschaltet am ${fmtDay(a.awardedAt)}` : <><LockIcon /> Noch gesperrt</>}
        </span>
      </div>

      <div className="rd-center rd-aw-title">
        <TierTag tier={a.tier} />
        <h1 className="rd-display rd-h1">{a.name}</h1>
        <p className="rd-muted">{a.text}</p>
      </div>

      {!a.unlocked && countable && (
        <div className="rd-card">
          <div className="rd-between">
            <span className="rd-label">Dein Fortschritt</span>
            <span className="rd-display rd-h3" style={{ color: "var(--rd-accent)" }}>{fmt(a.value)} / {fmt(a.threshold)}</span>
          </div>
          <div className="rd-aw-bar rd-aw-bar-thick" role="img" aria-label={`${fmt(a.value)} von ${fmt(a.threshold)} ${awardUnit(a.metric, a.threshold)}`}>
            <i style={{ width: `${Math.min(100, (a.value / a.threshold) * 100)}%` }} />
          </div>
          <div className="rd-muted" style={{ fontSize: 12.5 }}>
            {awardRemainingText(a)}
            {a.metric === "VISIT_DAYS" ? " Jeder Tag mit mindestens einem Start zählt." : ""}
            {a.metric === "EARLY_DAYS" ? " Es zählt die erste Stunde nach dem ersten Start des Tages." : ""}
            {a.lastPeriod ? ` Zuletzt geschafft: ${a.lastPeriod}.` : ""}
          </div>
        </div>
      )}

      {!a.unlocked && !countable && (
        <div className="rd-card">
          <span className="rd-label">So holst du ihn</span>
          <div className="rd-soft">
            Sei an dem Tag am Start, an dem er vergeben wird. Den Tag gibt das Team bekannt.
            {a.lastPeriod ? ` Zuletzt geschafft: ${a.lastPeriod}.` : ""}
          </div>
        </div>
      )}

      {a.voucherLabel && (
        <div className="rd-card rd-aw-reward">
          <span className="rd-aw-gift"><GiftIcon size={22} /></span>
          <div className="rd-grow">
            <span className="rd-label">Dein Gutschein</span>
            <div className="rd-aw-rw">{a.voucherLabel}</div>
            <div className="rd-muted" style={{ fontSize: 12.5, marginTop: 4 }}>
              {!a.unlocked && "Landet beim Freischalten automatisch unter „Gutscheine“."}
              {a.unlocked && v?.state === "open" && `Wartet unter „Gutscheine“ auf dich, ${validityText(v.expiresAt)}.`}
              {a.unlocked && v?.state === "redeemed" && `Eingelöst am ${fmtDay(v.redeemedAt)}.`}
              {a.unlocked && v?.state === "expired" && `Abgelaufen am ${fmtDay(v.expiresAt)}.`}
              {a.unlocked && !v && "Den Gutschein findest du unter „Gutscheine“."}
              {a.bonus ? ` Dazu: ${a.bonus}.` : ""}
            </div>
            {a.unlocked && v?.state === "open" && (
              <Link href={`${base}/gutscheine/${v.id}`} className="rd-btn rd-btn-sm" style={{ marginTop: 10 }}>
                <span>Gutschein zeigen</span>
              </Link>
            )}
          </div>
        </div>
      )}

      {!a.voucherLabel && a.bonus && (
        <div className="rd-card">
          <span className="rd-label">Dazu gibt es</span>
          <div className="rd-soft">{a.bonus}</div>
        </div>
      )}

      {ladder.length > 1 && (
        <section>
          <div className="rd-aw-sec-h"><span className="rd-label">Die Reihe</span></div>
          <div className="rd-aw-ladder">
            {ladder.map((s) => {
              const face = awardFace(s);
              return (
                <Link
                  key={s.id}
                  href={`${base}/awards/${s.id}`}
                  prefetch={false}
                  className={`rd-aw-step${s.unlocked ? " rd-aw-done" : ""}${s.id === a.id ? " rd-aw-cur" : ""}`}
                  aria-current={s.id === a.id ? "true" : undefined}
                >
                  <AwardBadge award={s} locked={!s.unlocked} size={60} noLock />
                  <b>{s.name}</b>
                  {face.big && <span>{fmt(s.threshold)} {awardUnit(s.metric, s.threshold)}</span>}
                  {s.voucherShort && <em>{s.voucherShort}</em>}
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}
