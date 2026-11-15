import Link from "next/link";
import { notFound } from "next/navigation";
import { loadRiderCached, riderAppPath } from "@/lib/rider-app";
import { METRIC_LABEL } from "@/lib/gamification";
import { fmtDay, validityText } from "@/lib/rider-format";

export const dynamic = "force-dynamic";

const QR_ICON = (
  <svg aria-hidden="true" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#1fe0ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><path d="M14 14h3v3h-3zM20 14v7M14 20h3" />
  </svg>
);

/** Dashboard: Abo, offene Gutscheine und die aktuelle Statistik. */
export default async function RiderDashboard({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const rider = await loadRiderCached(token);
  if (!rider) notFound();
  const base = riderAppPath(token);
  const open = rider.vouchers.filter((v) => v.state === "open");
  const { current, next } = rider.level;
  const others = rider.progress.filter((p) => !p.reached && p.id !== next?.id).slice(0, 3);

  return (
    <>
      <div className="rd-hero">
        <svg aria-hidden="true" viewBox="0 0 390 120" preserveAspectRatio="none" fill="none" stroke="#1fe0ff" strokeWidth="3" strokeLinecap="round">
          <path d="M-10 52 C 60 20, 120 84, 195 52 S 330 20, 400 52" opacity="0.55" />
          <path d="M-10 74 C 60 42, 120 106, 195 74 S 330 42, 400 74" opacity="0.3" />
          <path d="M-10 96 C 60 64, 120 128, 195 96 S 330 64, 400 96" opacity="0.15" />
        </svg>
        <div className="rd-hero-body">
          <div className="rd-hero-line">
            {rider.abo
              ? `${rider.abo.name}${rider.abo.endDate ? ` · ${rider.abo.active ? "gültig bis" : "abgelaufen am"} ${fmtDay(rider.abo.endDate)}` : ""}`
              : rider.accountName}
          </div>
          <h1 className="rd-display" style={{ fontSize: 48, fontWeight: 800 }}>Hi {rider.firstName}</h1>
        </div>
      </div>

      <div className="rd-between" style={{ marginTop: 4 }}>
        <div className="rd-label">Gutscheine</div>
        <Link href={`${base}/gutscheine`} style={{ fontSize: 12, textDecoration: "none" }}>alle ansehen</Link>
      </div>
      {open.length === 0 ? (
        <div className="rd-card rd-muted">
          {next?.voucherLabel
            ? `Dein nächster Gutschein: ${next.voucherLabel} bei ${next.threshold} ${METRIC_LABEL[next.metric]}.`
            : "Gerade kein offener Gutschein."}
        </div>
      ) : (
        <div className="rd-card rd-list">
          {open.slice(0, 3).map((v) => (
            <Link key={v.id} href={`${base}/gutscheine/${v.id}`}>
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
        <div className="rd-stat"><div className="rd-display">{rider.streakWeeks}</div><div className="rd-muted">Wochen Serie</div></div>
      </div>

      {others.length > 0 && (
        <>
          <div className="rd-label" style={{ marginTop: 4 }}>Weitere Ziele</div>
          <div className="rd-card" style={{ gap: 12 }}>
            {others.map((p) => (
              <div key={p.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div className="rd-between">
                  <b>{p.name}</b>
                  <span className="rd-muted">{p.value} von {p.threshold} {METRIC_LABEL[p.metric]}</span>
                </div>
                <div className="rd-bar" style={{ height: 8 }}><i style={{ width: `${Math.round((p.value / p.threshold) * 100)}%` }} /></div>
              </div>
            ))}
          </div>
        </>
      )}

      {!rider.enabled && (
        <div className="rd-card rd-muted">Die Zählung ist gerade pausiert. Deine bisherigen Werte bleiben erhalten.</div>
      )}
    </>
  );
}
