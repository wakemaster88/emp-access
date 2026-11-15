import { notFound, redirect } from "next/navigation";
import { riderAppPath } from "@/lib/rider-app";
import { findRiderAuthProfile, riderAccess } from "@/lib/rider-auth";
import { RiderSetup } from "@/components/rider/rider-auth";

export const dynamic = "force-dynamic";

/** Erstes Öffnen des Einladungslinks: Passkey oder Passwort einrichten. */
export default async function RiderSetupPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const profile = await findRiderAuthProfile(token);
  if (!profile) notFound();
  const access = await riderAccess(profile);
  if (access === "ok") redirect(riderAppPath(token));
  if (access === "login") redirect(`${riderAppPath(token)}/anmelden`);

  return (
    <>
      <div className="rd-label" style={{ marginTop: 12 }}>Willkommen</div>
      <h1 className="rd-display rd-h1">Zugang einrichten</h1>
      <p className="rd-soft" style={{ margin: 0 }}>
        Einmal einrichten, danach gehört die App nur dir. Der Einladungslink allein öffnet sie dann nicht mehr.
      </p>
      <RiderSetup token={token} />
    </>
  );
}
