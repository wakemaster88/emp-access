import { requireRider } from "@/lib/rider-auth";
import { daysUntil, fmtDay } from "@/lib/rider-format";
import { RiderProfileForm } from "@/components/rider/rider-profile-form";
import { RiderSecurity } from "@/components/rider/rider-auth";
import { RiderPush } from "@/components/rider/rider-push";
import { findRiderAuthProfile } from "@/lib/rider-auth";

export const dynamic = "force-dynamic";

/** Profil: Abo mit Laufzeit und enthaltenen Bereichen, Spitzname, Einwilligung, Ausstieg. */
export default async function RiderProfilePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const rider = await requireRider(token);
  const abo = rider.abo;
  const auth = await findRiderAuthProfile(token);

  return (
    <>
      <h1 className="rd-display rd-h1">Profil</h1>
      {abo && (
        <div className="rd-card">
          <div className="rd-label">Dein Abo</div>
          <div className="rd-between">
            <b style={{ fontSize: 16 }}>{abo.name}</b>
            <span className={`rd-pill ${abo.active ? "rd-pill-open" : "rd-pill-off"}`}>{abo.active ? "aktiv" : "nicht aktiv"}</span>
          </div>
          <div className="rd-muted">
            {abo.endDate ? (
              <>
                {abo.active ? "Gültig bis" : "Abgelaufen am"} <b style={{ color: "var(--rd-text)" }}>{fmtDay(abo.endDate)}</b>
                {abo.active && ` · noch ${daysUntil(abo.endDate)} Tage`}
              </>
            ) : (
              "Ohne Enddatum"
            )}
          </div>
          {abo.areas.length > 0 && (
            <>
              <div className="rd-label" style={{ marginTop: 6 }}>Inklusive</div>
              <div className="rd-chips">
                {abo.areas.map((a) => <span key={a} className="rd-chip">{a}</span>)}
              </div>
            </>
          )}
        </div>
      )}
      {auth && <RiderSecurity token={token} hasPassword={auth.passwordHash != null} passkeys={auth.passkeyCount} />}
      <RiderPush token={token} />
      <RiderProfileForm token={token} nickname={rider.nickname} showInRanking={rider.showInRanking} />
    </>
  );
}
