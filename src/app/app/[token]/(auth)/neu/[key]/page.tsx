import Link from "next/link";
import { notFound } from "next/navigation";
import { riderAppPath } from "@/lib/rider-app";
import { findRiderAuthProfile } from "@/lib/rider-auth";
import { riderResetKeyValid } from "@/lib/rider-reset";
import { RiderSetup } from "@/components/rider/rider-auth";

export const dynamic = "force-dynamic";

/** Link aus der Mail „Passwort vergessen“: neues Passwort oder Passkey festlegen. */
export default async function RiderResetPage({ params }: { params: Promise<{ token: string; key: string }> }) {
  const { token, key } = await params;
  const profile = await findRiderAuthProfile(token);
  if (!profile) notFound();

  if (!riderResetKeyValid(profile, key)) {
    return (
      <>
        <div className="rd-label" style={{ marginTop: 12 }}>Deine Saison</div>
        <h1 className="rd-display rd-h1">Link abgelaufen</h1>
        <div className="rd-msg rd-msg-err" role="alert">
          Dieser Link gilt nicht mehr. Er hält 60 Minuten und lässt sich nur einmal nutzen.
        </div>
        <Link href={`${riderAppPath(token)}/anmelden`} className="rd-btn rd-btn-wide"><span>Zur Anmeldung</span></Link>
      </>
    );
  }

  return (
    <>
      <div className="rd-label" style={{ marginTop: 12 }}>Deine Saison</div>
      <h1 className="rd-display rd-h1">Neu festlegen</h1>
      <p className="rd-soft" style={{ margin: 0 }}>
        Leg ein neues Passwort fest oder richte einen Passkey ein. Danach bist du angemeldet, auf anderen Geräten meldest du dich neu an.
      </p>
      <RiderSetup token={token} resetKey={key} />
    </>
  );
}
