import Link from "next/link";
import { verifyMailLinkKey } from "@/lib/day-guest";
import { aboRuntimeLabel, onboardingState } from "@/lib/rider-onboarding";
import { RiderAboChoice } from "@/components/rider/rider-abo-choice";

export const dynamic = "force-dynamic";

/** Nach dem Mail-Link: gefundene Abos zur Adresse auswählen. */
export default async function RiderWelcomePage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const link = verifyMailLinkKey(key);
  if (!link) {
    return (
      <main className="rd-main">
        <div className="rd-msg rd-msg-err" role="alert">Dieser Link gilt nicht mehr.</div>
        <Link href="/app" className="rd-btn rd-btn-wide"><span>Neuen Link anfordern</span></Link>
      </main>
    );
  }
  const state = await onboardingState(link.accountId, link.email);
  const now = new Date();
  return (
    <main className="rd-main">
      <p className="rd-label">Willkommen</p>
      <h1 className="rd-display rd-h1">{state.abos.length > 0 ? "Deine Abos" : "Fast geschafft"}</h1>
      <p className="rd-soft" style={{ margin: 0 }}>
        {state.abos.length > 0
          ? `Zu ${link.email} haben wir diese Abos gefunden. Wähle die aus, die dir gehören.`
          : `Zu ${link.email} haben wir noch kein Abo gefunden. Du kannst die App trotzdem nutzen und dein Abo direkt darin buchen.`}
      </p>
      <RiderAboChoice
        mailKey={key}
        abos={state.abos.map((a) => ({
          ticketId: a.ticketId,
          holder: a.holder,
          aboName: a.aboName,
          runtime: aboRuntimeLabel(a.endDate, now),
          expired: a.endDate != null && a.endDate.getTime() < now.getTime(),
        }))}
      />
      {state.abos.length > 1 && (
        <p className="rd-muted" style={{ margin: 0 }}>
          Abos deiner Kinder wählst du hier nicht aus. Du fügst sie danach in der App unter Profil › Familie hinzu.
        </p>
      )}
    </main>
  );
}
