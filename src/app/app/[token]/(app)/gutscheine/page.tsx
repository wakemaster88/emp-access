import Link from "next/link";
import { AwardBadge } from "@/components/rider/award-badge";
import { CheckIcon, GiftIcon, LockIcon, TierTag } from "@/components/rider/award-parts";
import { awardRemainingText, voucherHeadline } from "@/lib/awards";
import { riderAppPath, type RiderVoucher } from "@/lib/rider-app";
import { requireRider } from "@/lib/rider-auth";
import { fmtDay, validityText } from "@/lib/rider-format";

export const dynamic = "force-dynamic";

const QR_ICON = (
  <svg aria-hidden="true" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><path d="M14 14h3v3h-3zM20 14v7M14 20h3" />
  </svg>
);

/** Offener Gutschein als Abriss-Ticket: Abzeichen des Awards, Leistung, Frist und der Weg zum Code. */
function Ticket({ v, href }: { v: RiderVoucher; href: string }) {
  const { head, detail } = voucherHeadline(v.label, v.award?.voucherShort);
  return (
    <Link href={href} prefetch className="rd-aw-vt">
      <span className="rd-aw-vt-b">
        {v.award ? <AwardBadge award={v.award} size={70} /> : <span className="rd-aw-gift" style={{ margin: "0 8px" }}><GiftIcon size={22} /></span>}
      </span>
      <span className="rd-aw-vt-t">
        {v.award ? <TierTag tier={v.award.tier} /> : v.source ? <span className="rd-label">{v.source}</span> : null}
        {v.award && <span className="rd-label" style={{ display: "block" }}>{v.award.name}</span>}
        <span className="rd-display rd-aw-vt-h" style={{ display: "block" }}>{head}</span>
        {detail && <span className="rd-aw-vt-d" style={{ display: "block" }}>{detail}</span>}
        <span className="rd-aw-vt-v" style={{ display: "block" }}>{v.expiresAt ? `Gültig bis ${fmtDay(v.expiresAt)}, ${validityText(v.expiresAt)}` : "Ohne Ablauf"}</span>
      </span>
      <span className="rd-aw-vt-q">
        {QR_ICON}
        <span>Zeigen</span>
      </span>
    </Link>
  );
}

/** Alle Gutscheine des Fahrers: offene zuerst, dann die nächsten aus den Awards, dann eingelöste und abgelaufene. */
export default async function RiderVouchers({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const rider = await requireRider(token);
  const base = riderAppPath(token);
  const open = rider.vouchers.filter((v) => v.state === "open");
  const past = rider.vouchers.filter((v) => v.state !== "open");
  // Die zwei Awards mit Gutschein, denen am wenigsten fehlt.
  const soon = rider.awards
    .filter((a) => !a.unlocked && a.voucherLabel && a.metric !== "EVENT_DAYS" && a.threshold > 0)
    .sort((a, b) => b.value / b.threshold - a.value / a.threshold)
    .slice(0, 2);

  return (
    <>
      <h1 className="rd-display rd-h1">Gutscheine</h1>
      <p className="rd-muted" style={{ margin: 0 }}>
        Awards und Challenges bringen dir Gutscheine. Zeig den Code am Imbiss oder an der Kasse.
      </p>

      <section>
        <div className="rd-aw-sec-h">
          <span className="rd-label">Offen</span>
          <span className="rd-aw-cnt">{open.length}</span>
        </div>
        {open.length === 0 ? (
          <div className="rd-card rd-muted">Gerade kein offener Gutschein. Der nächste kommt mit deinem nächsten Award.</div>
        ) : (
          <div className="rd-aw-vlist">
            {open.map((v) => <Ticket key={v.id} v={v} href={`${base}/gutscheine/${v.id}`} />)}
          </div>
        )}
      </section>

      {soon.length > 0 && (
        <section>
          <div className="rd-aw-sec-h"><span className="rd-label">Als Nächstes</span></div>
          <div className="rd-aw-vlist" style={{ gap: 8 }}>
            {soon.map((a) => (
              <Link key={a.id} href={`${base}/awards/${a.id}`} prefetch={false} className="rd-aw-vd rd-aw-vs">
                <span className="rd-aw-tease" style={{ flex: "none" }}><AwardBadge award={a} size={48} /></span>
                <span>
                  <b>{a.voucherLabel}</b>
                  <small>{a.name} · {awardRemainingText(a)}</small>
                </span>
                <LockIcon />
              </Link>
            ))}
          </div>
        </section>
      )}

      {past.length > 0 && (
        <section>
          <div className="rd-aw-sec-h">
            <span className="rd-label">Eingelöst und abgelaufen</span>
            <span className="rd-aw-cnt">{past.length}</span>
          </div>
          <div className="rd-aw-vlist" style={{ gap: 8 }}>
            {past.map((v) => (
              <div key={v.id} className="rd-aw-vd">
                {v.award ? <AwardBadge award={v.award} size={44} /> : <span style={{ width: 44, display: "grid", placeItems: "center" }}><GiftIcon size={20} /></span>}
                <span>
                  <b>{v.label}</b>
                  <small>
                    {v.award ? `${v.award.name} · ` : ""}
                    {v.state === "redeemed" ? `eingelöst am ${fmtDay(v.redeemedAt)}` : `abgelaufen am ${fmtDay(v.expiresAt)}`}
                  </small>
                </span>
                {v.state === "redeemed" && <CheckIcon size={16} />}
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
