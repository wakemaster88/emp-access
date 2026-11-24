import { riderBase } from "@/lib/rider-base";
import Link from "next/link";
import { AwardBadge } from "@/components/rider/award-badge";
import { GiftIcon, NextAwardCard, RewardLine, TierTag } from "@/components/rider/award-parts";
import {
  AWARD_CATEGORIES, CATEGORY_LABEL, awardCountable, nextAward, tierRank, tileSpans, type AwardCategory,
} from "@/lib/awards";
import { GAMI_TIERS, TIER_LABEL } from "@/lib/gamification";
import { type RiderAward, type RiderView } from "@/lib/rider-app";
import { requireRider } from "@/lib/rider-auth";
import { fmtDay } from "@/lib/rider-format";

export const dynamic = "force-dynamic";

const fmt = (n: number) => n.toLocaleString("de-DE");

function progressText(a: RiderAward): string {
  return `${fmt(a.value)} / ${fmt(a.threshold)}`;
}

/** Unterzeile einer gesperrten Kachel: Fortschritt, der letzte Erfolg oder „noch offen“. */
function LockedFoot({ a, wide }: { a: RiderAward; wide?: boolean }) {
  if (!awardCountable(a)) {
    return <span className="rd-aw-pr">{a.lastPeriod ? `${a.lastPeriod} geschafft` : "noch offen"}</span>;
  }
  const bar = (
    <div className="rd-aw-mini" role="img" aria-label={`${progressText(a)} erreicht`}>
      <i style={{ width: `${Math.min(100, (a.value / a.threshold) * 100)}%` }} />
    </div>
  );
  if (wide) {
    return (
      <div className="rd-aw-wbar">
        {bar}
        <span className="rd-aw-pr">{progressText(a)}</span>
      </div>
    );
  }
  return (
    <>
      {bar}
      <span className="rd-aw-pr">{a.value === 0 && a.lastPeriod ? `${a.lastPeriod} geschafft` : progressText(a)}</span>
    </>
  );
}

function Tile({ a, span, base }: { a: RiderAward; span: number; base: string }) {
  const href = `${base}/awards/${a.id}`;
  const state = a.unlocked ? " rd-aw-un" : " rd-aw-lk";
  if (span > 1) {
    return (
      <Link href={href} prefetch={false} className={`rd-aw-tile rd-aw-wide rd-aw-w${span}${state}${a.tier === "LEGENDARY" ? " rd-aw-legend" : ""}`}>
        <AwardBadge award={a} locked={!a.unlocked} size={span === 2 ? 84 : 100} />
        <div className="rd-aw-wt">
          <TierTag tier={a.tier} />
          <div className="rd-aw-tn">{a.name}</div>
          {span === 3 && <div className="rd-aw-wd">{a.text}</div>}
          {!a.unlocked && <LockedFoot a={a} wide />}
          {a.voucherShort && (
            <div className="rd-aw-rwrow">
              <span className={`rd-aw-rwtag${a.unlocked && a.voucher?.state === "open" ? "" : " rd-aw-ol"}`}>
                <GiftIcon size={13} /> {a.voucherShort}
              </span>
              {a.bonus && span === 3 && <span className="rd-aw-plus">+ {a.bonus}</span>}
            </div>
          )}
        </div>
      </Link>
    );
  }
  return (
    <Link href={href} prefetch={false} className={`rd-aw-tile${state}`}>
      <AwardBadge award={a} locked={!a.unlocked} size={88} />
      <div className="rd-aw-tn">{a.name}</div>
      {a.unlocked ? <TierTag tier={a.tier} /> : <LockedFoot a={a} />}
      <RewardLine award={a} />
    </Link>
  );
}

function statLine(cat: AwardCategory, rider: RiderView): React.ReactNode {
  if (cat === "starts") return <><b className="rd-display">{fmt(rider.startsTotal)}</b> Starts gesamt</>;
  if (cat === "days") return <><b className="rd-display">{rider.visitDays}</b> Besuchstage in {rider.year}</>;
  if (cat === "loyalty" && rider.seasons > 0) {
    return (
      <>
        <b className="rd-display">{rider.seasons}</b> {rider.seasons === 1 ? "Saison" : "Saisons"} dabei
        {rider.seasonsSince ? `, seit ${rider.seasonsSince}` : ""}
      </>
    );
  }
  return null;
}

/** Trophy Case: alle Awards mit Stand, der nächste Award und offene Gutscheine. */
export default async function RiderAwards({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const rider = await requireRider(token);
  const base = await riderBase(token);
  const { awards } = rider;
  const unlocked = awards.filter((a) => a.unlocked);
  const next = nextAward(awards);
  const openVouchers = rider.vouchers.filter((v) => v.state === "open");
  const recent = [...unlocked]
    .sort((a, b) => (b.awardedAt?.getTime() ?? 0) - (a.awardedAt?.getTime() ?? 0))
    .slice(0, 3);
  const groups = AWARD_CATEGORIES.map((cat) => ({ cat, list: awards.filter((a) => a.category === cat) })).filter((g) => g.list.length > 0);

  return (
    <>
      <header className="rd-hero rd-aw-hero">
        <div className="rd-hero-body">
          <div className="rd-hero-line">Deine Awards</div>
          <h1 className="rd-display" style={{ fontSize: 48, fontWeight: 800 }}>Trophy Case</h1>
        </div>
        <div className="rd-aw-hero-row">
          <div className="rd-display rd-aw-big">
            {unlocked.length}
            <small>/{awards.length}</small>
          </div>
          <div className="rd-aw-tiers">
            {GAMI_TIERS.map((t) => (
              <span key={t}>
                <b className={`rd-aw-dot rd-aw-d-${t.toLowerCase()}`} />
                {unlocked.filter((a) => a.tier === t).length} {TIER_LABEL[t]}
              </span>
            ))}
          </div>
        </div>
        <div className="rd-aw-bar rd-aw-hero-bar" role="img" aria-label={`${unlocked.length} von ${awards.length} Awards freigeschaltet`}>
          <i style={{ width: `${awards.length ? (unlocked.length / awards.length) * 100 : 0}%` }} />
        </div>
      </header>

      {awards.length === 0 && <div className="rd-card rd-muted">Hier stehen bald deine Awards. Schau später noch einmal rein.</div>}

      {!rider.enabled && awards.length > 0 && (
        <div className="rd-card rd-muted">Die Zählung ist gerade pausiert. Deine bisherigen Awards bleiben erhalten.</div>
      )}

      {next && <NextAwardCard award={next} href={`${base}/awards/${next.id}`} />}

      {openVouchers.length > 0 && (
        <Link href={`${base}/gutscheine`} className="rd-card rd-aw-vz">
          <span className="rd-aw-gift"><GiftIcon size={22} /></span>
          <span className="rd-grow">
            <b style={{ fontSize: 15 }}>{openVouchers.length === 1 ? "1 Gutschein offen" : `${openVouchers.length} Gutscheine offen`}</b>
            <br />
            <span className="rd-muted" style={{ fontSize: 12.5 }}>
              {openVouchers.slice(0, 3).map((v) => v.award?.voucherShort ?? v.label).join(" · ")}
            </span>
          </span>
          <span className="rd-aw-go">Einlösen ›</span>
        </Link>
      )}

      {groups.length > 1 && (
        <nav className="rd-aw-chips" aria-label="Reihen">
          {groups.map((g) => (
            <a key={g.cat} href={`#aw-${g.cat}`}>{g.cat === "starts" ? "Starts" : CATEGORY_LABEL[g.cat]}</a>
          ))}
        </nav>
      )}

      {recent.length > 0 && (
        <section>
          <div className="rd-aw-sec-h"><span className="rd-label">Zuletzt freigeschaltet</span></div>
          <div className="rd-aw-recent">
            {recent.map((a) => (
              <Link key={a.id} href={`${base}/awards/${a.id}`} prefetch={false}>
                <AwardBadge award={a} size={68} />
                <b>{a.name}</b>
                <span>{fmtDay(a.awardedAt)}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {groups.map(({ cat, list }) => {
        const spans = tileSpans(list.length);
        const line = statLine(cat, rider);
        // In der Reihe steht das kleinste Ziel vorn, bei gleichem Ziel das seltenere hinten.
        const sorted = cat === "special" ? list : [...list].sort((a, b) => a.threshold - b.threshold || tierRank(a.tier) - tierRank(b.tier));
        return (
          <section key={cat} id={`aw-${cat}`} className="rd-aw-sec">
            <div className="rd-aw-sec-h">
              <span className="rd-label">{cat === "days" ? `Besuchstage Saison ${rider.year}` : CATEGORY_LABEL[cat]}</span>
              <span className="rd-aw-cnt">{list.filter((a) => a.unlocked).length} / {list.length}</span>
            </div>
            {line && <div className="rd-aw-stat">{line}</div>}
            <div className="rd-aw-grid">
              {sorted.map((a, i) => <Tile key={a.id} a={a} span={spans[i]} base={base} />)}
            </div>
          </section>
        );
      })}
    </>
  );
}
