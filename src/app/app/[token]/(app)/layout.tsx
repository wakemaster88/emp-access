import Link from "next/link";
import { riderAppPath } from "@/lib/rider-app";
import { requireRider, riderFamilyView } from "@/lib/rider-auth";
import { RiderNav } from "@/components/rider/rider-nav";
import { RiderInstallHint } from "@/components/rider/rider-install-hint";

/** Geschützter Teil der Kunden-App: ohne Anmeldung geht es zum Einrichten oder Anmelden. */
export default async function RiderAppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  await requireRider(token);
  const family = await riderFamilyView(token);
  // Die angemeldete Person steht vorn, danach Partner und Kinder.
  const members =
    family && family.members.length > 1
      ? [...family.members].sort((a, b) => Number(b.token === family.viewerToken) - Number(a.token === family.viewerToken))
      : [];
  return (
    <>
      <main className="rd-main">
        {members.length > 0 && (
          <nav className="rd-family" aria-label="Familie">
            {members.map((m) => (
              <Link key={m.profileId} href={riderAppPath(m.token)} aria-current={m.token === token ? "true" : undefined}>
                {m.token === family?.viewerToken ? "Ich" : m.name}
              </Link>
            ))}
          </nav>
        )}
        {children}
      </main>
      <RiderNav base={riderAppPath(token)} />
      <RiderInstallHint />
    </>
  );
}
