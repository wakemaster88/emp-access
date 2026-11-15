import { prisma } from "@/lib/prisma";
import { RiderLogin } from "@/components/rider/rider-login";
import { RiderTicketClaim } from "@/components/rider/rider-ticket-claim";

export const dynamic = "force-dynamic";

/** Einstieg in die Kunden-App ohne persönlichen Link. */
export default async function RiderLoginPage() {
  // Den Weg für Tagesgäste nur zeigen, wenn er irgendwo eingeschaltet ist.
  const dayGuests = await prisma.gamificationConfig
    .count({ where: { enabled: true, dayServiceIds: { isEmpty: false } } })
    .catch(() => 0);
  return (
    <main className="rd-main">
      <p className="rd-label">Für Abo-Fahrer</p>
      <h1 className="rd-display rd-h1">Deine Saison</h1>
      <p className="rd-soft" style={{ margin: 0 }}>
        Besuchstage, Starts, Meilensteine und deine Gutscheine. Melde dich einmal an, danach öffnet sich die App direkt.
      </p>
      <RiderLogin />
      <p className="rd-muted" style={{ margin: 0 }}>
        Kein Geburtsdatum hinterlegt oder die Karte nicht zur Hand? An der Kasse bekommst du deinen persönlichen Link als QR-Code.
      </p>

      {dayGuests > 0 && (
        <>
          <p className="rd-label" style={{ marginTop: 12 }}>Mit Tagesticket</p>
          <p className="rd-soft" style={{ margin: 0 }}>
            Auch ohne Abo kannst du Besuche sammeln und Gutscheine verdienen. Scanne den QR-Code auf deinem Ticket. Mit Armband oder Karte zeigt dir die Kasse einen QR-Code.
          </p>
          <RiderTicketClaim />
        </>
      )}
    </main>
  );
}
