import { notFound, redirect } from "next/navigation";
import { riderAppPath } from "@/lib/rider-app";
import { findRiderAuthProfile, riderAccess, sessionRider } from "@/lib/rider-auth";
import { RiderSetup } from "@/components/rider/rider-auth";
import { RiderFamilyClaim } from "@/components/rider/rider-family";

export const dynamic = "force-dynamic";

/** Erstes Öffnen des Einladungslinks: Passkey oder Passwort einrichten. */
export default async function RiderSetupPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const profile = await findRiderAuthProfile(token);
  if (!profile) notFound();
  const access = await riderAccess(profile);
  if (access === "ok") redirect(riderAppPath(token));
  if (access === "login") redirect(`${riderAppPath(token)}/anmelden`);

  // Eltern öffnen den Link ihres Kindes, während sie selbst angemeldet sind.
  const me = await sessionRider();
  const claimable =
    !!me && me.id !== profile.id && me.accountId === profile.accountId && profile.familyId == null && (me.familyId == null || me.familyAdult);

  return (
    <>
      <div className="rd-label" style={{ marginTop: 12 }}>Willkommen</div>
      <h1 className="rd-display rd-h1">Zugang einrichten</h1>
      <p className="rd-soft" style={{ margin: 0 }}>
        Einmal einrichten, danach gehört die App nur dir. Der Einladungslink allein öffnet sie dann nicht mehr.
      </p>
      {claimable && (
        <div className="rd-card" style={{ gap: 10 }}>
          <b>Das Abo deines Kindes?</b>
          <span className="rd-muted">
            Du bist auf diesem Gerät schon angemeldet. Hol dieses Abo in deine Familie, dann braucht es keinen eigenen Zugang und du siehst es in deiner App.
          </span>
          <RiderFamilyClaim token={token} />
        </div>
      )}
      {claimable && <p className="rd-label" style={{ margin: "4px 0 0" }}>Oder eigenen Zugang anlegen</p>}
      <RiderSetup token={token} />
    </>
  );
}
