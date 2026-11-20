import { RiderMailLink } from "@/components/rider/rider-mail-link";

export const dynamic = "force-dynamic";

/** Einstieg in die Kunden-App: Anmeldung per E-Mail-Link, mit oder ohne Abo. */
export default async function RiderLoginPage({ searchParams }: { searchParams: Promise<{ link?: string }> }) {
  const expired = (await searchParams).link === "abgelaufen";
  return (
    <main className="rd-main">
      {expired && (
        <div className="rd-msg rd-msg-err" role="alert">Dieser Link gilt nicht mehr. Fordere unten einfach einen neuen an.</div>
      )}
      <p className="rd-label">Deine App</p>
      <h1 className="rd-display rd-h1">Deine Saison</h1>
      <p className="rd-soft" style={{ margin: 0 }}>
        Abo, Besuchstage, Starts, Meilensteine und deine Gutscheine. Gib deine E-Mail-Adresse ein, wir schicken dir einen Link. Hast du schon ein Abo, wählst du es danach aus. Ohne Abo geht es genauso.
      </p>
      <RiderMailLink />
      <p className="rd-muted" style={{ margin: 0 }}>
        Keine Mail bekommen? Schau im Spam-Ordner nach. An der Kasse bekommst du deinen persönlichen Link auch als QR-Code.
      </p>
    </main>
  );
}
