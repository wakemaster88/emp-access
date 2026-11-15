import Link from "next/link";
import { riderAppPath } from "@/lib/rider-app";
import { requireRider } from "@/lib/rider-auth";
import { fmtDay, validityText } from "@/lib/rider-format";

export const dynamic = "force-dynamic";

/** Alle Gutscheine des Fahrers: offene zuerst, dann eingelöste und abgelaufene. */
export default async function RiderVouchers({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const rider = await requireRider(token);
  const base = riderAppPath(token);

  return (
    <>
      <h1 className="rd-display rd-h1">Gutscheine</h1>
      {rider.vouchers.length === 0 ? (
        <div className="rd-card rd-muted">
          Noch kein Gutschein. Du bekommst einen, sobald du einen Meilenstein mit Gutschein erreichst.
        </div>
      ) : (
        <div className="rd-card rd-list">
          {rider.vouchers.map((v) =>
            v.state === "open" ? (
              <Link key={v.id} href={`${base}/gutscheine/${v.id}`}>
                <span className="rd-grow">
                  <b>{v.label}</b>
                  <br />
                  <span className="rd-muted">{validityText(v.expiresAt)}</span>
                </span>
                <span className="rd-pill rd-pill-open">offen</span>
              </Link>
            ) : (
              <div key={v.id} className="rd-dim">
                <span className="rd-grow">
                  <b>{v.label}</b>
                  <br />
                  <span>{v.state === "redeemed" ? `eingelöst am ${fmtDay(v.redeemedAt)}` : `abgelaufen am ${fmtDay(v.expiresAt)}`}</span>
                </span>
                <span className="rd-pill rd-pill-off">{v.state === "redeemed" ? "eingelöst" : "abgelaufen"}</span>
              </div>
            ),
          )}
        </div>
      )}
    </>
  );
}
