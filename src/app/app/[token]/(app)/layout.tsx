import Link from "next/link";
import { riderAppPath } from "@/lib/rider-app";
import { requireRider, riderFamilyView } from "@/lib/rider-auth";
import { RiderNav } from "@/components/rider/rider-nav";
import { RiderInstallHint } from "@/components/rider/rider-install-hint";
import { RiderSync } from "@/components/rider/rider-sync";
import { RiderIntro } from "@/components/rider/rider-intro";
import { AwardBadgeDefs } from "@/components/rider/award-badge";
import { RiderAwardUnlock } from "@/components/rider/rider-award-unlock";
import { nextAward } from "@/lib/awards";
import { riderRenderStamp } from "@/lib/rider-local";

/** Geschützter Teil der Kunden-App: ohne Anmeldung geht es zum Einrichten oder Anmelden. */
export default async function RiderAppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const rider = await requireRider(token);
  // Zeitpunkt dieses Renderns: kommt die Seite später aus dem lokalen Cache, erkennt RiderSync das Alter.
  const renderedAt = riderRenderStamp();
  const family = await riderFamilyView(token);
  // Die angemeldete Person steht vorn, danach Partner und Kinder.
  const members =
    family && family.members.length > 1
      ? [...family.members].sort((a, b) => Number(b.token === family.viewerToken) - Number(a.token === family.viewerToken))
      : [];
  // Freischalt-Momente sieht die Person selbst, bei einem Kind auch die Eltern. Der Partner nicht.
  const unlocks = family?.relation === "view" ? [] : rider.unlocks;
  const next = nextAward(rider.awards);
  return (
    <>
      <AwardBadgeDefs />
      <main className="rd-main">
        {members.length > 0 && (
          <nav className="rd-family" aria-label="Familie">
            {members.map((m) => (
              <Link key={m.profileId} href={riderAppPath(m.token)} prefetch aria-current={m.token === token ? "true" : undefined}>
                {m.token === family?.viewerToken ? "Ich" : m.name}
              </Link>
            ))}
          </nav>
        )}
        {children}
      </main>
      <RiderNav base={riderAppPath(token)} />
      <RiderInstallHint />
      <RiderSync renderedAt={renderedAt} />
      <RiderAwardUnlock
        token={token}
        base={riderAppPath(token)}
        unlocks={unlocks}
        next={next ? { name: next.name, tier: next.tier, metric: next.metric, threshold: next.threshold, key: next.key, value: next.value } : null}
        stats={[
          { value: rider.visitDays.toLocaleString("de-DE"), label: `Besuchstage ${rider.year}` },
          { value: rider.startsTotal.toLocaleString("de-DE"), label: "Starts gesamt" },
          { value: String(rider.awards.filter((a) => a.unlocked).length), label: "Awards" },
        ]}
      />
      <RiderIntro />
    </>
  );
}
