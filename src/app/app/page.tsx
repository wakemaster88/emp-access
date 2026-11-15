import { RiderLogin } from "@/components/rider/rider-login";

/** Einstieg in die Kunden-App ohne persönlichen Link. */
export default function RiderLoginPage() {
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
    </main>
  );
}
