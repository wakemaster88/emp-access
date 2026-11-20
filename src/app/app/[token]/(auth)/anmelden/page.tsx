import { notFound, redirect } from "next/navigation";
import { riderAppPath } from "@/lib/rider-app";
import { findRiderAuthProfile, riderAccess } from "@/lib/rider-auth";
import { resetEmailFor } from "@/lib/rider-reset";
import { maskEmail } from "@/lib/rider-reset-key";
import { RiderForgot, RiderSignIn } from "@/components/rider/rider-auth";

export const dynamic = "force-dynamic";

/** Anmeldung mit Passkey oder Passwort; Passwort vergessen per Mail-Link. */
export default async function RiderSignInPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const profile = await findRiderAuthProfile(token);
  if (!profile) notFound();
  const access = await riderAccess(profile);
  if (access === "ok") redirect(riderAppPath(token));
  if (access === "setup" || access === "held") redirect(`${riderAppPath(token)}/einrichten`);
  const email = await resetEmailFor(profile.id);

  return (
    <>
      <div className="rd-label" style={{ marginTop: 12 }}>Deine Saison</div>
      <h1 className="rd-display rd-h1">Anmelden</h1>
      <RiderSignIn token={token} hasPassword={profile.passwordHash != null} hasPasskey={profile.passkeyCount > 0} />
      <RiderForgot token={token} maskedEmail={email ? maskEmail(email) : null} />
    </>
  );
}
