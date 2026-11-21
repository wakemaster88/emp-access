import Link from "next/link";
import { riderAppPath } from "@/lib/rider-app";
import { requireRider, riderFamilyView } from "@/lib/rider-auth";
import { kontoRidersFor } from "@/lib/rider-konto";
import { RiderForWhom } from "@/components/rider/rider-for-whom";
import { METRIC_LABEL, RENEWAL_HINT_DAYS, formatDegrees, formatEuro } from "@/lib/gamification";
import { loadWaterNow } from "@/lib/gamification-service";
import { loadAirNow } from "@/lib/weather-history";
import { loadRiderChallengesCached, loadRiderOffers } from "@/lib/rider-challenges";
import { fmtDay, validityText } from "@/lib/rider-format";
import { aboStatus, RIDER_LOCATION } from "@/lib/rider-shop";
import { loadRiderOccupancy, OCCUPANCY_LABEL } from "@/lib/rider-occupancy";
import { loadRiderOpening } from "@/lib/rider-opening";
import { BEACH_LABEL, loadBeachOccupancy } from "@/lib/beach-occupancy";
import { awardRemainingText, nextAward } from "@/lib/awards";
import { berlinYmd } from "@/lib/berlin-day";
import type { RiderView } from "@/lib/rider-app";
import { AwardBadge } from "@/components/rider/award-badge";
import { NextAwardCard } from "@/components/rider/award-parts";

export const dynamic = "force-dynamic";

const QR_ICON = (
  <svg aria-hidden="true" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><path d="M14 14h3v3h-3zM20 14v7M14 20h3" />
  </svg>
);

const CLOCK_ICON = (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
  </svg>
);

const PIN_ICON = (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" />
  </svg>
);

const CHEVRON_RIGHT = (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 6l6 6-6 6" />
  </svg>
);

function clock(at: Date): string {
  return at.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });
}

/**
 * Tagesauswertung oben auf der Startseite, sobald die Person heute am Lift
 * gestartet ist. Alles kommt aus dem schon geladenen Fahrer (eine kleine
 * Abfrage auf die Tageszeile), damit die Startseite nicht langsamer wird.
 */
function TodayCard({
  rider,
  base,
  water,
  air,
  challenge,
}: {
  rider: RiderView;
  base: string;
  water: number | null;
  air: number | null;
  challenge: { name: string; value: number; threshold: number | null; kind: string } | null;
}) {
  const t = rider.today!;
  const minutes = Math.max(0, Math.round((t.lastStartAt.getTime() - t.firstStartAt.getTime()) / 60_000));
  const ymd = berlinYmd(new Date());
  const unlockedToday = rider.awards.filter((a) => a.unlocked && a.awardedAt && berlinYmd(a.awardedAt) === ymd);
  const upcoming = nextAward(rider.awards);
  const cold = rider.awards.find((a) => a.metric === "COLD_DAYS" && a.tempBelow != null);
  const waterNow = t.waterTemp ?? water;
  const record = t.bestBefore > 0 && t.starts > t.bestBefore;
  const task = challenge && challenge.kind === "TASK" && challenge.threshold != null ? challenge : null;

  return (
    <section className="rd-card rd-today" aria-label="Dein Tag heute">
      <div className="rd-between">
        <div className="rd-label">Dein Tag heute</div>
        <span className="rd-muted" style={{ fontSize: 12 }}>Besuchstag {rider.visitDays} in {rider.year}</span>
      </div>
      <div className="rd-today-stats">
        <div>
          <span className="rd-display">{t.starts}</span>
          <span className="rd-muted">{t.starts === 1 ? "Start" : "Starts"}</span>
        </div>
        {t.starts > 1 ? (
          <div>
            <span className="rd-display">
              {minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}` : minutes}
              <small>{minutes >= 60 ? " h" : " min"}</small>
            </span>
            <span className="rd-muted">am Lift</span>
          </div>
        ) : (
          <div>
            <span className="rd-display">{rider.dayGuest ? "–" : clock(t.firstStartAt)}</span>
            <span className="rd-muted">erster Start</span>
          </div>
        )}
        {waterNow != null ? (
          <div>
            <span className="rd-display">{formatDegrees(Math.round(waterNow * 10) / 10)}°</span>
            <span className="rd-muted">Wasser</span>
          </div>
        ) : air != null ? (
          <div>
            <span className="rd-display">{formatDegrees(Math.round(air) || 0)}°</span>
            <span className="rd-muted">Luft</span>
          </div>
        ) : (
          <div>
            <span className="rd-display">{rider.starts}</span>
            <span className="rd-muted">Starts {rider.year}</span>
          </div>
        )}
      </div>
      <span className="rd-soft">
        {t.starts > 1 && !rider.dayGuest ? `Am Lift von ${clock(t.firstStartAt)} bis ${clock(t.lastStartAt)} Uhr. ` : ""}
        {record ? (
          <span className="rd-today-rec">Neuer Saisonrekord! Bisher {t.bestBefore} Starts an einem Tag.</span>
        ) : t.bestBefore > 0 ? (
          `Dein Rekord ${rider.year}: ${t.bestBefore} Starts an einem Tag.`
        ) : (
          "Dein erster Tag am Lift in dieser Saison."
        )}
      </span>
      {cold && t.waterTemp != null && t.waterTemp < cold.tempBelow! && (
        <span className="rd-soft">
          Wasser unter {formatDegrees(cold.tempBelow!)}°: heute zählt für {cold.name}.
        </span>
      )}
      {unlockedToday.length > 0 && (
        <Link href={`${base}/awards`} prefetch className="rd-today-row">
          {unlockedToday.slice(0, 3).map((a) => <AwardBadge key={a.id} award={a} size={44} />)}
          <span className="rd-grow">
            <b>Heute freigeschaltet</b>
            <br />
            <span className="rd-muted">{unlockedToday.map((a) => a.name).join(", ")}</span>
          </span>
          {CHEVRON_RIGHT}
        </Link>
      )}
      {upcoming && (
        <Link href={`${base}/awards/${upcoming.id}`} prefetch={false} className="rd-today-row">
          <span className="rd-grow">
            <b>{upcoming.name}</b> <span className="rd-muted">· {awardRemainingText(upcoming)}</span>
            <span className="rd-bar" style={{ display: "block" }}>
              <i style={{ width: `${Math.min(100, (upcoming.value / upcoming.threshold) * 100)}%` }} />
            </span>
          </span>
          {CHEVRON_RIGHT}
        </Link>
      )}
      {task && (
        <Link href={`${base}/challenges`} className="rd-today-row">
          <span className="rd-grow">
            <b>{task.name}</b> <span className="rd-muted">· {Math.min(task.value, task.threshold!)} von {task.threshold}</span>
            <span className="rd-bar" style={{ display: "block" }}>
              <i style={{ width: `${Math.min(100, Math.round((task.value / task.threshold!) * 100))}%` }} />
            </span>
          </span>
          {CHEVRON_RIGHT}
        </Link>
      )}
    </section>
  );
}

/** Dashboard: Abo, offene Gutscheine und die aktuelle Statistik. */
export default async function RiderDashboard({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const rider = await requireRider(token);
  const base = riderAppPath(token);
  const [offers, challenges, occupancy, opening, family, beach, air, water] = await Promise.all([
    loadRiderOffers(rider.accountId),
    loadRiderChallengesCached(rider),
    loadRiderOccupancy(rider.accountId).catch(() => null),
    loadRiderOpening(rider.accountId).catch(() => null),
    riderFamilyView(token),
    loadBeachOccupancy(rider.accountId).catch(() => null),
    // Luft und Wasser für den Kopf: zwei kleine Abfragen neben den anderen, kein Abruf nach außen.
    loadAirNow(rider.accountId).catch(() => null),
    loadWaterNow(rider.accountId).catch(() => null),
  ]);
  // Neue Abos des Kundenkontos ohne Fahrer: nur im eigenen Profil fragen.
  const konto = family?.relation === "self" ? await kontoRidersFor(rider.profileId) : null;
  const challenge = challenges.find((c) => c.phase === "running" && !c.won) ?? null;
  const open = rider.vouchers.filter((v) => v.state === "open");
  const { current, next } = rider.level;
  const abo = aboStatus(rider.abo);
  const soon = abo.kind === "active" && abo.daysLeft <= RENEWAL_HINT_DAYS;
  // Lift zu und niemand gefahren: „Geschlossen“ statt „Gerade ruhig“ und leerem Balken.
  const closedQuiet = opening != null && !opening.open && occupancy?.riders === 0;
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
          <div className="rd-hero-top">
            <div className="rd-hero-line rd-loc">{PIN_ICON}{RIDER_LOCATION}</div>
            {(air != null || water != null) && (
              <div className="rd-hero-temps">
                {air != null && <span>Luft <b>{formatDegrees(Math.round(air) || 0)}°</b></span>}
                {water != null && <span>Wasser <b>{formatDegrees(Math.round(water * 10) / 10)}°</b></span>}
              </div>
            )}
          </div>
          <h1 className="rd-display" style={{ fontSize: 48, fontWeight: 800 }}>{rider.firstName ? `Hi ${rider.firstName}` : "Hi"}</h1>
        </div>
      </div>

      {rider.today && <TodayCard rider={rider} base={base} water={water} air={air} challenge={challenge} />}

      {konto && konto.abos.length > 0 && (
        <RiderForWhom
          token={token}
          abos={konto.abos.map((a) => ({
            ticketId: a.ticketId,
            aboName: a.aboName,
            runtime: a.endDate ? `bis ${fmtDay(a.endDate)}` : "ohne Enddatum",
            lastName: a.lastName,
          }))}
          persons={konto.persons.map((p) => ({ id: p.id, label: p.id === rider.profileId ? "Ich" : p.name }))}
        />
      )}

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

      {abo.kind === "paymentOpen" && rider.abo && (
        <div className="rd-card rd-abo-warn" role="status" style={{ gap: 4 }}>
          <div className="rd-label">Dein Abo</div>
          <b style={{ fontSize: 15 }}>Zahlung offen, Abo pausiert</b>
          <span className="rd-soft">
            {rider.abo.name}: {abo.text} Bitte bezahl die Rechnung in deinem anny-Konto. Danach ist dein Abo
            automatisch wieder aktiv{abo.endDate ? ` und gilt bis ${fmtDay(abo.endDate)}` : ""}.
          </span>
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
          {abo.kind === "none" && (
            <Link href={`${base}/profil`} className="rd-muted" style={{ marginTop: 4, minHeight: 44, display: "flex", alignItems: "center" }}>
              Abo schon gekauft? Im Profil gibt es den Code für die Kasse.
            </Link>
          )}
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
          {closedQuiet ? (
            <div className="rd-display rd-h2">Geschlossen</div>
          ) : (
            <>
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
            </>
          )}
          {opening && (
            <Link href={`${base}/zeiten`} prefetch className={`rd-hours${opening.open ? " rd-hours-open" : ""}`}>
              {CLOCK_ICON}
              <span className="rd-grow">
                {opening.text}
                {opening.note ? ` (${opening.note})` : ""}
              </span>
              <span className="rd-hours-more">Kalender{CHEVRON_RIGHT}</span>
            </Link>
          )}
        </div>
      )}

      {beach && (
        <div className="rd-card">
          <div className="rd-between">
            <div className="rd-label">{beach.areaName} jetzt</div>
            <span className="rd-muted" style={{ fontSize: 12 }}>
              Stand {beach.at.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" })} Uhr
            </span>
          </div>
          <div className="rd-display rd-h2">{BEACH_LABEL[beach.level]}</div>
          <div
            className={`rd-bar rd-occ-${beach.level}`}
            role="img"
            aria-label={`${beach.areaName}: ${BEACH_LABEL[beach.level]}`}
          >
            <i style={{ width: `${Math.max(beach.percent, 3)}%` }} />
          </div>
          <span className="rd-muted">Geschätzt aus den Eintritten der letzten 3 Stunden.</span>
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
