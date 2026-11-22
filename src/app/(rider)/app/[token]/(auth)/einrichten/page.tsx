import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { riderHome } from "@/lib/rider-base";
import { findRiderAuthProfile, riderAccess, riderHolder, sessionRider } from "@/lib/rider-auth";
import { memberName } from "@/lib/rider-family";
import { aboSentence, setupGreeting } from "@/lib/rider-setup";
import { RiderSetup } from "@/components/rider/rider-auth";
import { RiderFamilyClaim } from "@/components/rider/rider-family";

export const dynamic = "force-dynamic";

/** „Lisas“, aber „Jonas’“. */
function genitive(name: string): string {
  return /[sßxz]$/i.test(name) ? `${name}’` : `${name}s`;
}

/**
 * Erstes Öffnen des Einladungslinks: Passkey oder Passwort einrichten, mit
 * Namen und Abo der Person. Nur solange das Konto noch nicht aktiv ist: Mit
 * eigenem Zugang geht es zur Anmeldung, gehört die Person schon zu einem
 * eingerichteten Zugang (Familie, Kundenkonto), zeigt die Seite nur, wo man
 * sich anmeldet (lib/rider-auth `riderHolder`).
 */
export default async function RiderSetupPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const profile = await findRiderAuthProfile(token);
  if (!profile) notFound();
  const access = await riderAccess(profile);
  if (access === "ok") redirect(await riderHome(token));
  if (access === "login") redirect(`${await riderHome(token)}/anmelden`);

  const greeting = await setupGreeting(profile.id);
  const name = greeting?.firstName ?? null;
  const label = greeting ? `Willkommen bei ${greeting.accountName}` : "Willkommen";

  if (access === "held") {
    const holder = await riderHolder(profile);
    const abo = aboSentence(greeting?.abo ?? null, name ? genitive(name) : "Dieses");
    const who = name ?? "Diese Person";
    return (
      <>
        <div className="rd-label" style={{ marginTop: 12 }}>{label}</div>
        <h1 className="rd-display rd-h1">{name ? `${name} ist schon dabei` : "Schon eingerichtet"}</h1>
        <p className="rd-soft" style={{ margin: 0 }}>
          {abo ? `${abo} ` : ""}
          {who} gehört zum Konto von {holder?.name ?? "jemandem"}, das schon eingerichtet ist. Deshalb legt dieser Link keinen zweiten
          Zugang an. Melde dich mit dem Zugang von {holder?.name ?? "diesem Konto"} an, dort {name ? `steht ${name}` : "steht das Abo"} unter Familie.
        </p>
        {holder && (
          <Link href={`${await riderHome(holder.token)}/anmelden`} className="rd-btn rd-btn-wide"><span>Anmelden</span></Link>
        )}
      </>
    );
  }

  // Eltern öffnen den Link ihres Kindes, während sie selbst angemeldet sind.
  // Bei Erwachsenen (Geburtsdatum) nicht: die treten über die Einladung bei.
  const me = await sessionRider();
  const claimable =
    !!me && me.id !== profile.id && me.accountId === profile.accountId && profile.familyId == null && (me.familyId == null || me.familyAdult)
    && greeting?.adult !== true;
  const meName = claimable && me
    ? await prisma.riderProfile
        .findUnique({
          where: { id: me.id },
          select: { firstName: true, nickname: true, tickets: { select: { firstName: true, name: true, endDate: true, subscriptionId: true }, orderBy: { id: "desc" }, take: 5 } },
        })
        .then((r) => (r ? memberName(r) : null))
    : null;
  const abo = aboSentence(greeting?.abo ?? null, "Dein");

  return (
    <>
      <div className="rd-label" style={{ marginTop: 12 }}>{label}</div>
      <h1 className="rd-display rd-h1">{name ? `Hallo ${name}` : "Zugang einrichten"}</h1>
      <p className="rd-soft" style={{ margin: 0 }}>
        {abo ? `${abo} ` : ""}
        {name ? "Richte einmal deinen Zugang ein" : "Einmal einrichten"}, danach gehört die App nur dir. Der Link allein öffnet sie dann nicht mehr.
      </p>
      {claimable && (
        <div className="rd-card" style={{ gap: 10 }}>
          <b>{name ? `Ist ${name} dein Kind?` : "Das Abo deines Kindes?"}</b>
          <span className="rd-muted">
            Du bist auf diesem Gerät {meName ? `als ${meName} ` : ""}angemeldet. Hol {name ?? "dieses Abo"} in deine Familie, dann
            braucht {name ?? "es"} keinen eigenen Zugang und du siehst {greeting?.abo ? `das ${greeting.abo.name}` : "das Abo"} in deiner App.
          </span>
          <RiderFamilyClaim token={token} />
        </div>
      )}
      {claimable && <p className="rd-label" style={{ margin: "4px 0 0" }}>{name ? `Oder ${name} richtet selbst ein` : "Oder eigenen Zugang anlegen"}</p>}
      <RiderSetup token={token} />
    </>
  );
}
