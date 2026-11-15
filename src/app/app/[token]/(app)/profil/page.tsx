import { requireRider } from "@/lib/rider-auth";
import { daysUntil, fmtDay } from "@/lib/rider-format";
import { RiderProfileForm } from "@/components/rider/rider-profile-form";
import { RiderSecurity } from "@/components/rider/rider-auth";
import { RiderPush } from "@/components/rider/rider-push";
import { findRiderAuthProfile, riderFamilyView } from "@/lib/rider-auth";
import { RiderFamily } from "@/components/rider/rider-family";

export const dynamic = "force-dynamic";

/** Profil: Abo mit Laufzeit und enthaltenen Bereichen, Spitzname, Einwilligung, Ausstieg. */
export default async function RiderProfilePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const rider = await requireRider(token);
  const abo = rider.abo;
  const auth = await findRiderAuthProfile(token);
  const family = await riderFamilyView(token);
  const relation = family?.relation ?? "self";
  const self = relation === "self";
  const member = family?.members.find((m) => m.token === token);

  return (
    <>
      <h1 className="rd-display rd-h1">Profil</h1>
      {abo && (
        <div className="rd-card">
          <div className="rd-label">{self ? "Dein Abo" : `Abo von ${member?.name ?? "Mitglied"}`}</div>
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
      {self ? (
        <>
          {auth && <RiderSecurity token={token} hasPassword={auth.passwordHash != null} passkeys={auth.passkeyCount} />}
          <RiderPush token={token} />
          {auth && family && (
            <RiderFamily token={token} selfId={auth.id} members={family.members} childOfFamily={family.childOfFamily} />
          )}
          <RiderProfileForm token={token} nickname={rider.nickname} showInRanking={rider.showInRanking} />
        </>
      ) : relation === "manage" ? (
        <>
          <div className="rd-msg rd-msg-ok">
            Du verwaltest dieses Profil für {member?.name ?? "dein Kind"}. Entfernen kannst du es in deinem eigenen Profil unter Familie.
          </div>
          <RiderProfileForm token={token} nickname={rider.nickname} showInRanking={rider.showInRanking} managed />
        </>
      ) : (
        <div className="rd-msg rd-msg-ok">
          Du siehst das Profil von {member?.name ?? "deinem Partner"}. Einstellungen und Zugang ändert jeder selbst.
        </div>
      )}
    </>
  );
}
