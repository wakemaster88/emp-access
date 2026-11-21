import Link from "next/link";
import { riderAppPath } from "@/lib/rider-app";
import { sessionRider } from "@/lib/rider-auth";
import { familyInviteInfo } from "@/lib/rider-family";
import { RiderFamilyJoin } from "@/components/rider/rider-family";

export const dynamic = "force-dynamic";

/** Einladungslink in eine Familie: der Partner tritt mit seinem eigenen Zugang bei. */
export default async function RiderFamilyInvitePage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const invite = await familyInviteInfo(decodeURIComponent(key));
  const me = await sessionRider();
  const usable = invite && (!me || me.accountId === invite.accountId);

  return (
    <main className="rd-main">
      <p className="rd-label">Familie</p>
      <h1 className="rd-display rd-h1">Einladung</h1>
      {!usable ? (
        <div className="rd-msg rd-msg-err" role="alert">
          Diese Einladung gilt nicht mehr. Bitte lass dir einen neuen Link schicken.
        </div>
      ) : !me ? (
        <>
          <p className="rd-soft" style={{ margin: 0 }}>
            {invite.inviterName} lädt dich in die Familie ein. Melde dich zuerst mit deinem eigenen Abo an und öffne diesen Link danach noch einmal.
          </p>
          <Link href="/app" className="rd-btn rd-btn-wide"><span>Zur Anmeldung</span></Link>
        </>
      ) : me.familyId === invite.familyId && me.familyAdult ? (
        <>
          <p className="rd-soft" style={{ margin: 0 }}>
            Du gehörst schon zu dieser Familie. Schick den Link an deinen Partner, damit er beitreten kann.
          </p>
          <Link href={`${riderAppPath(me.token)}/profil`} className="rd-btn rd-btn-wide"><span>Zu meinem Profil</span></Link>
        </>
      ) : (
        <>
          <p className="rd-soft" style={{ margin: 0 }}>
            {invite.inviterName} lädt dich in die Familie ein. Ihr seht dann gegenseitig Abo, Statistik und Gutscheine und verwaltet gemeinsam die Kinder. Gezählt wird weiter für jeden einzeln, und du kannst die Familie jederzeit im Profil verlassen.
          </p>
          <RiderFamilyJoin inviteKey={decodeURIComponent(key)} />
        </>
      )}
    </main>
  );
}
