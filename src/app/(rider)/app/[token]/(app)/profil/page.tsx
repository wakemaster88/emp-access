import { notFound } from "next/navigation";
import { requireRider } from "@/lib/rider-auth";
import { daysUntil, fmtDay } from "@/lib/rider-format";
import { RiderProfileForm } from "@/components/rider/rider-profile-form";
import { RiderLogout, RiderLogoutEverywhere, RiderSecurity } from "@/components/rider/rider-auth";
import { RiderPush } from "@/components/rider/rider-push";
import { RiderPerson } from "@/components/rider/rider-person";
import { findRiderAuthProfileCached, riderFamilyView } from "@/lib/rider-auth";
import { loadRiderPerson } from "@/lib/rider-person";
import { RiderFamily } from "@/components/rider/rider-family";
import { RiderKasseCode } from "@/components/rider/rider-kasse-code";
import "./profil.css";

export const dynamic = "force-dynamic";

/**
 * Profil: oben Bild, Name und persönliche Daten (änderbar), dann Abo,
 * „Abo fehlt?“ (Code für die Kasse), Spitzname, Familie, Anmeldung und
 * Benachrichtigungen; unten Abmelden (dieses Gerät oder alle).
 * Statistik löschen gibt es nicht (Aaron, 20.11.2026).
 */
export default async function RiderProfilePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const rider = await requireRider(token);
  const abo = rider.abo;
  const [auth, family, person] = await Promise.all([findRiderAuthProfileCached(token), riderFamilyView(token), loadRiderPerson(token)]);
  if (!person) notFound();
  const relation = family?.relation ?? "self";
  const self = relation === "self";
  const member = family?.members.find((m) => m.token === token);

  const subtitle = self
    ? [rider.nickname ? `„${rider.nickname}“` : null, person.email].filter(Boolean).join(" · ") || null
    : relation === "manage"
      ? "Du verwaltest dieses Profil"
      : "Nur ansehen, ändern kann es nur die Person selbst";

  return (
    <>
      <RiderPerson
        token={token}
        firstName={person.firstName}
        lastName={person.lastName}
        birthDate={person.birthDate}
        photoUrl={person.photoUrl}
        subtitle={subtitle}
        editable={relation === "self" || relation === "manage"}
        managed={relation === "manage"}
        birthDateLocked={person.birthDateLocked}
      />

      {abo && (
        <>
          <h2 className="rd-label rd-sec">{self ? "Dein Abo" : `Abo von ${member?.name ?? "Mitglied"}`}</h2>
          <div className="rd-card">
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
              <div className="rd-chips">
                {abo.areas.map((a) => <span key={a} className="rd-chip">{a}</span>)}
              </div>
            )}
          </div>
        </>
      )}

      {self ? (
        <>
          {auth && !(auth.familyId != null && !auth.familyAdult) && <RiderKasseCode token={token} />}
          <h2 className="rd-label rd-sec">Spitzname und Rangliste</h2>
          <RiderProfileForm token={token} nickname={rider.nickname} showInRanking={rider.showInRanking} />
          {auth && family && (
            <RiderFamily token={token} selfId={auth.id} members={family.members} childOfFamily={family.childOfFamily} />
          )}
          {auth && (
            <>
              <h2 className="rd-label rd-sec">Anmeldung</h2>
              <RiderSecurity token={token} hasPassword={auth.passwordHash != null} passkeys={auth.passkeyCount} />
            </>
          )}
          <RiderPush token={token} />
          <div className="rd-sec-end">
            <RiderLogout token={token} />
            <RiderLogoutEverywhere token={token} />
          </div>
        </>
      ) : relation === "manage" ? (
        <>
          <h2 className="rd-label rd-sec">Spitzname und Rangliste</h2>
          <RiderProfileForm token={token} nickname={rider.nickname} showInRanking={rider.showInRanking} managed />
          <span className="rd-muted rd-note">Entfernen kannst du {member?.name ?? "dein Kind"} in deinem eigenen Profil unter Familie.</span>
        </>
      ) : null}
    </>
  );
}
