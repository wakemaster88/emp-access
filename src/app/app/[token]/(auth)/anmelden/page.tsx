import { notFound, redirect } from "next/navigation";
import { riderAppPath } from "@/lib/rider-app";
import { findRiderAuthProfile, riderAccess } from "@/lib/rider-auth";
import { RiderSignIn } from "@/components/rider/rider-auth";

export const dynamic = "force-dynamic";

/** Anmeldung mit Passkey oder Passwort. */
export default async function RiderSignInPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const profile = await findRiderAuthProfile(token);
  if (!profile) notFound();
  const access = await riderAccess(profile);
  if (access === "ok") redirect(riderAppPath(token));
  if (access === "setup") redirect(`${riderAppPath(token)}/einrichten`);

  return (
    <>
      <div className="rd-label" style={{ marginTop: 12 }}>Deine Saison</div>
      <h1 className="rd-display rd-h1">Anmelden</h1>
      <RiderSignIn token={token} hasPassword={profile.passwordHash != null} hasPasskey={profile.passkeyCount > 0} />
      <p className="rd-muted" style={{ margin: 0 }}>
        Passwort vergessen oder neues Handy? An der Kasse setzen wir deinen Zugang zurück und du bekommst einen neuen Link.
      </p>
    </>
  );
}
