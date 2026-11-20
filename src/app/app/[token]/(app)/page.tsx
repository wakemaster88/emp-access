import Link from "next/link";
import { riderAppPath } from "@/lib/rider-app";
import { requireRider } from "@/lib/rider-auth";
import { METRIC_LABEL, RENEWAL_HINT_DAYS, formatEuro } from "@/lib/gamification";
import { loadRiderChallengesCached, loadRiderOffers } from "@/lib/rider-challenges";
import { fmtDay, validityText } from "@/lib/rider-format";
import { aboStatus, RIDER_LOCATION } from "@/lib/rider-shop";
import { loadRiderOccupancy, OCCUPANCY_LABEL } from "@/lib/rider-occupancy";
import { nextAward } from "@/lib/awards";
import { AwardBadge } from "@/components/rider/award-badge";
import { NextAwardCard } from "@/components/rider/award-parts";

export const dynamic = "force-dynamic";

const QR_ICON = (
  <svg aria-hidden="true" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><path d="M14 14h3v3h-3zM20 14v7M14 20h3" />
  </svg>
);

const PIN_ICON = (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" />
  </svg>
);

/** Dashboard: Abo, offene Gutscheine und die aktuelle Statistik. */
export default async function RiderDashboard({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const rider = await requireRider(token);
  const base = riderAppPath(token);
  const [offers, challenges, occupancy] = await Promise.all([
    loadRiderOffers(rider.accountId),
    loadRiderChallengesCached(rider),
    loadRiderOccupancy(rider.accountId).catch(() => null),
  ]);
  const challenge = challenges.find((c) => c.phase === "running" && !c.won) ?? null;
  const open = rider.vouchers.filter((v) => v.state === "open");
  const { current, next } = rider.level;
  const abo = aboStatus(rider.abo);
  const soon = abo.kind === "active" && abo.daysLeft <= RENEWAL_HINT_DAYS;
  const upcoming = nextAward(rider.awards);
  const earned = rider.awards
    .filter((a) => a.unlocked)
    .sort((a, b) => (b.awardedAt?.getTime() ?? 0) - (a.awardedAt?.getTime() ?? 0));
  // Der Gutschein, der als Nächstes winkt: vom nächsten Award, sonst von der nächsten Stufe.
  const nextVoucher = upcoming?.voucherLabel
    ? `Dein nächster Gutschein: ${upcoming.voucherLabel} für den Award ${upcoming.name}.`
    : next?.voucherLabel
      ? `Dein nächster Gutschein: ${next.voucherLabel} bei ${next.threshold} ${METRIC_LABEL[next.metric]}.`
      : "Gerade kein offener Gutschein.";

  return (
    <>
      <div className="rd-hero">
        <svg aria-hidden="true" viewBox="0 0 390 120" preserveAspectRatio="none" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <path d="M-10 52 C 60 20, 120 84, 195 52 S 330 20, 400 52" opacity="0.55" />
          <path d="M-10 74 C 60 42, 120 106, 195 74 S 330 42, 400 74" opacity="0.3" />
          <path d="M-10 96 C 60 64, 120 128, 195 96 S 330 64, 400 96" opacity="0.15" />
        </svg>
        <div className="rd-hero-body">
          <div className="rd-hero-line rd-loc">{PIN_ICON}{RIDER_LOCATION}</div>
          <h1 className="rd-display" style={{ fontSize: 48, fontWeight: 800 }}>{rider.firstName ? `Hi ${rider.firstName}` : "Hi"}</h1>
        </div>
      </div>

      {abo.kind === "active" && rider.abo && (
        <div className={`rd-card${soon ? " rd-abo-warn" : ""}`}>
          <div className="rd-label">Dein Abo</div>
          <b style={{ fontSize: 15 }}>{rider.abo.name}</b>
          <div className="rd-abo-days">
            {abo.daysLeft <= 0 ? (
              <span>Gilt nur noch heute</span>
            ) : (
              <>
                <span className="rd-display">{abo.daysLeft}</span>
                <span>{abo.daysLeft === 1 ? "Tag gültig" : "Tage gültig"}</span>
              </>
            )}
          </div>
          <span className="rd-muted">bis {fmtDay(abo.endDate)}</span>
          {soon && (
            <Link href={`${base}/abos`} className="rd-btn rd-btn-wide" style={{ marginTop: 4 }}>
              <span>Abo verlängern</span>
            </Link>
          )}
        </div>
      )}

      {abo.kind === "unlimited" && rider.abo && (
        <div className="rd-card">
          <div className="rd-label">Dein Abo</div>
          <b style={{ fontSize: 15 }}>{rider.abo.name}</b>
          <span className="rd-muted">gültig ohne Ablaufdatum</span>
        </div>
      )}

      {(abo.kind === "expired" || abo.kind === "none") && (
        <div className="rd-card rd-offer" style={{ gap: 4 }}>
          <b>
            {abo.kind === "none"
              ? "Du hast noch kein Abo"
              : abo.endDate && abo.endDate.getTime() < Date.now()
                ? "Dein Abo ist abgelaufen"
                : "Dein Abo ist gerade nicht gültig"}
          </b>
          <span className="rd-soft">
            {abo.kind === "none"
              ? `Mit einem Abo fährst du am ${RIDER_LOCATION} so oft du willst.`
              : `${rider.abo?.name ?? "Dein Abo"}${abo.endDate ? ` galt bis ${fmtDay(abo.endDate)}` : " ist nicht aktiv"}. Buch dir direkt hier ein neues.`}
          </span>
          <Link href={`${base}/abos`} className="rd-btn rd-btn-wide" style={{ marginTop: 8 }}>
            <span>{abo.kind === "none" ? "Abos ansehen" : "Abo buchen"}</span>
          </Link>
        </div>
      )}

      {occupancy && (
        <div className="rd-card">
          <div className="rd-between">
            <div className="rd-label">Auslastung jetzt</div>
            <span className="rd-muted" style={{ fontSize: 12 }}>
              Stand {occupancy.at.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" })} Uhr
            </span>
          </div>
          <div className="rd-between">
            <div className="rd-display rd-h2">{OCCUPANCY_LABEL[occupancy.level]}</div>
            <span className="rd-muted">
              {occupancy.riders === 1 ? "1 Fahrer" : `${occupancy.riders} Fahrer`}
            </span>
          </div>
          <div
            className={`rd-bar rd-occ-${occupancy.level}`}
            role="img"
            aria-label={`${OCCUPANCY_LABEL[occupancy.level]}: ${occupancy.riders} Fahrer und ${occupancy.starts} Starts in der letzten Stunde`}
          >
            <i style={{ width: `${occupancy.percent}%` }} />
          </div>
          <span className="rd-muted">
            {occupancy.riders === 0
              ? "In der letzten Stunde ist niemand am Lift gestartet."
              : `${occupancy.starts === 1 ? "1 Start" : `${occupancy.starts} Starts`} am Lift in der letzten Stunde.`}
          </span>
        </div>
      )}

      {rider.calculator && (
        <div className="rd-card rd-offer" style={{ gap: 4 }}>
          <b>Lohnt sich ein Abo für dich?</b>
          <span className="rd-soft">
            Deine {rider.calculator.tickets} Besuche dieser Saison haben {formatEuro(rider.calculator.spentCents)} gekostet.
            Das Abo {rider.calculator.aboName} kostet {formatEuro(rider.calculator.aboCents)}.
          </span>
        </div>
      )}

      {offers.length > 0 && (
        <>
          <div className="rd-label" style={{ marginTop: 4 }}>Angebote</div>
          {offers.slice(0, 3).map((o) => (
            <div key={o.id} className="rd-card rd-offer" style={{ gap: 4 }}>
              <b>{o.title}</b>
              {o.text && <span className="rd-soft">{o.text}</span>}
              {o.validTo && <span className="rd-muted">bis {fmtDay(o.validTo)}</span>}
            </div>
          ))}
        </>
      )}

      {challenge && (
        <>
          <div className="rd-between" style={{ marginTop: 4 }}>
            <div className="rd-label">Challenge</div>
            <Link href={`${base}/challenges`} style={{ fontSize: 12, textDecoration: "none" }}>alle ansehen</Link>
          </div>
          <Link href={`${base}/challenges`} className="rd-card" style={{ textDecoration: "none", color: "inherit" }}>
            <div className="rd-between">
              <div className="rd-display rd-h2">{challenge.name}</div>
              <span className="rd-muted">
                {challenge.kind === "TASK" && challenge.threshold != null
                  ? `${Math.min(challenge.value, challenge.threshold)} von ${challenge.threshold}`
                  : challenge.rank != null ? `Platz ${challenge.rank}` : "noch offen"}
              </span>
            </div>
            {challenge.kind === "TASK" && challenge.threshold != null && (
              <div className="rd-bar"><i style={{ width: `${Math.min(100, Math.round((challenge.value / challenge.threshold) * 100))}%` }} /></div>
            )}
            {challenge.voucherLabel && <span className="rd-muted">Gewinn: {challenge.voucherLabel}</span>}
          </Link>
        </>
      )}

      <div className="rd-between" style={{ marginTop: 4 }}>
        <div className="rd-label">Gutscheine</div>
        <Link href={`${base}/gutscheine`} style={{ fontSize: 12, textDecoration: "none" }}>alle ansehen</Link>
      </div>
      {open.length === 0 ? (
        <div className="rd-card rd-muted">{nextVoucher}</div>
      ) : (
        <div className="rd-card rd-list">
          {open.slice(0, 3).map((v) => (
            <Link key={v.id} href={`${base}/gutscheine/${v.id}`} prefetch>
              {QR_ICON}
              <span className="rd-grow">
                <b>{v.label}</b>
                <br />
                <span className="rd-muted">{validityText(v.expiresAt)}</span>
              </span>
              <span className="rd-btn rd-btn-sm"><span>Zeigen</span></span>
            </Link>
          ))}
        </div>
      )}

      {rider.awards.length > 0 && (
        <>
          <div className="rd-between" style={{ marginTop: 4 }}>
            <div className="rd-label">Awards · {earned.length} von {rider.awards.length}</div>
            <Link href={`${base}/awards`} style={{ fontSize: 12, textDecoration: "none" }}>alle ansehen</Link>
          </div>
          {earned.length > 0 && (
            <Link href={`${base}/awards`} prefetch className="rd-card rd-aw-strip" aria-label={`${earned.length} Awards freigeschaltet, alle ansehen`}>
              {earned.slice(0, 5).map((a) => <AwardBadge key={a.id} award={a} size={60} />)}
            </Link>
          )}
          {upcoming && <NextAwardCard award={upcoming} href={`${base}/awards/${upcoming.id}`} />}
        </>
      )}

      <div className="rd-label" style={{ marginTop: 4 }}>Deine Saison {rider.year}</div>
      {(current || next) && (
        <div className="rd-card">
          <div className="rd-between">
            <div className="rd-display rd-h2">{current?.name ?? "Los geht’s"}</div>
            {next && <div className="rd-muted">noch {next.threshold - next.value} bis {next.name}</div>}
          </div>
          {next && (
            <div className="rd-bar" role="img" aria-label={`${next.value} von ${next.threshold} ${METRIC_LABEL[next.metric]}`}>
              <i style={{ width: `${Math.round((next.value / next.threshold) * 100)}%` }} />
            </div>
          )}
        </div>
      )}
      <div className="rd-stats">
        <div className="rd-stat"><div className="rd-display">{rider.visitDays}</div><div className="rd-muted">Besuchstage</div></div>
        <div className="rd-stat"><div className="rd-display">{rider.starts}</div><div className="rd-muted">Starts</div></div>
        <div className="rd-stat"><div className="rd-display">{rider.streakWeeks}</div><div className="rd-muted">Wochen in Serie</div></div>
      </div>

      {rider.visitDays > 0 && (
        <Link href={`${base}/rueckblick`} className="rd-btn rd-btn-ghost rd-btn-wide">
          <span>Dein Saisonrückblick {rider.year}</span>
        </Link>
      )}

      {rider.dayGuest && (
        <p className="rd-muted" style={{ margin: 0 }}>
          Neue Tickets zählen von selbst mit, wenn sie auf deine E-Mail-Adresse gebucht sind. An der Kasse trägt man sie dir auch gern ein.
        </p>
      )}

      {!rider.enabled && (
        <div className="rd-card rd-muted">Die Zählung ist gerade pausiert. Deine bisherigen Werte bleiben erhalten.</div>
      )}
    </>
  );
}
