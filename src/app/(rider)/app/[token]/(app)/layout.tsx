import { riderAppKind, riderBase, riderRest } from "@/lib/rider-base";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { APP_PREFIX } from "@/lib/rider-app-kind";
import { requireRider, riderFamilyView } from "@/lib/rider-auth";
import { RiderNav } from "@/components/rider/rider-nav";
import { RiderInstallHint } from "@/components/rider/rider-install-hint";
import { RiderSync } from "@/components/rider/rider-sync";
import { RiderIntro } from "@/components/rider/rider-intro";
import { RiderViewing } from "@/components/rider/rider-switch";
import { AwardBadgeDefs } from "@/components/rider/award-badge";
import { RiderAwardUnlock } from "@/components/rider/rider-award-unlock";
import { nextAward } from "@/lib/awards";
import { riderRenderStamp } from "@/lib/rider-local";
import { PASS_NAME, PASS_WORD } from "@/lib/rider-pass";
import { FAMILY_INVITE_COOKIE, pendingFamilyInvite } from "@/lib/rider-family-invite";

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
  const base = await riderBase(token);
  // Gewechselt wird am Gruß der Startseite; sonst nur ein Hinweis, wenn eine andere Person angezeigt wird.
  const viewing = family && family.viewerToken !== token ? family.members.find((m) => m.token === token) : undefined;
  // Zwei Apps: wer nur ein Strandbad-Abo hat, gehört in den Beach Pass (/beach),
  // alle anderen in den Ride Pass (/app). Gleiche Seite in der richtigen App.
  const kind = await riderAppKind();
  const wanted = rider.pass === "BEACH" ? "beach" : "ride";
  if (!viewing && base === `${APP_PREFIX[kind]}/${encodeURIComponent(token)}` && kind !== wanted) {
    redirect(`${APP_PREFIX[wanted]}/${encodeURIComponent(token)}${await riderRest()}`);
  }
  // Freischalt-Momente sieht die Person selbst, bei einem Kind auch die Eltern. Der Partner nicht.
  const unlocks = family?.relation === "view" ? [] : rider.unlocks;
  const next = nextAward(rider.awards);
  const beach = rider.pass === "BEACH";
  // Einladung in eine Familie aus der Mail: wartet im Cookie, bis die Person
  // sie auf der Einladungsseite annimmt oder ablehnt. Ohne Cookie keine Abfrage.
  const inviteCookie = (await cookies()).get(FAMILY_INVITE_COOKIE)?.value;
  const invite = inviteCookie && !viewing ? await pendingFamilyInvite(token, inviteCookie) : null;
  return (
    // Beach Pass: eigene Farben über `.rd-pass-beach` (rider.css), sonst alles gleich.
    <div className={beach ? "rd-pass-beach" : undefined} style={{ display: "contents" }}>
      <AwardBadgeDefs />
      <main className="rd-main">
        {family && viewing && <RiderViewing base={base} name={viewing.name} selfToken={family.viewerToken} />}
        {invite && (
          <div className="rd-viewing" role="status">
            <span><b>{invite.inviterName}</b> lädt dich in die Familie ein</span>
            <Link href={`${APP_PREFIX[kind]}/familie/${encodeURIComponent(invite.key)}`}>Ansehen</Link>
          </div>
        )}
        {children}
      </main>
      <RiderNav base={base} />
      <RiderInstallHint name={PASS_NAME[rider.pass]} />
      <RiderSync renderedAt={renderedAt} />
      <RiderAwardUnlock
        token={token}
        base={base}
        unlocks={unlocks}
        next={next ? { name: next.name, tier: next.tier, metric: next.metric, threshold: next.threshold, key: next.key, value: next.value } : null}
        stats={[
          { value: rider.visitDays.toLocaleString("de-DE"), label: `Besuchstage ${rider.year}` },
          beach
            ? { value: rider.streakWeeks.toLocaleString("de-DE"), label: rider.streakWeeks === 1 ? "Woche in Serie" : "Wochen in Serie" }
            : { value: rider.startsTotal.toLocaleString("de-DE"), label: "Starts gesamt" },
          { value: String(rider.awards.filter((a) => a.unlocked).length), label: "Awards" },
        ]}
      />
      <RiderIntro word={PASS_WORD[rider.pass]} />
    </div>
  );
}
