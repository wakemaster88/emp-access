/**
 * Erzeugt alle plausiblen Varianten eines gescannten Codes.
 *
 * Hintergrund: Barcode-/RFID-Scanner schicken die Zeichen als
 * Tastatur-Events. Wenn der Scanner ein US-Layout emuliert, das
 * Betriebssystem aber auf DE konfiguriert ist, werden manche Zeichen
 * falsch interpretiert. Typische Faelle:
 *
 *   - Scanner-"-" (US, Bindestrich) → DE-Layout: "ß"
 *     ⇒ "GS-1234" wird zu "GSß1234" (oder "gsß1234")
 *   - Scanner-"_" (US, Shift-Bindestrich) → DE-Layout: "?"
 *   - Scanner sendet ggf. "#" / "%" als Praefix
 *   - Manche RFID-Reader (z. B. das Modell am Drehkreuz "Seilbahn A")
 *     unterdruecken bei numerischen Tag-IDs fuehrende Nullen. Eine
 *     RFID `0506339173` (10-stellig) kommt dann als `506339173`
 *     (9-stellig) am Server an und findet kein Ticket. Wir
 *     ergaenzen deshalb fuer rein numerische Codes mit weniger als
 *     10 Stellen die plausiblen Zero-Padding-Varianten bis Laenge
 *     10. Fallback wird nur genutzt, wenn der Original-Code keinen
 *     Treffer liefert (Direct-Match hat immer Vorrang).
 *
 * Damit der Server Tickets/Vouchers trotzdem findet, geben wir alle
 * sinnvollen Permutationen zurueck.
 */
export function buildScanCodeVariants(input: string): string[] {
  const raw = String(input ?? "");
  const trimmed = raw.trim();
  const noWhitespace = trimmed.replace(/\s+/g, "");
  const stripped = noWhitespace.replace(/^[#%]+/, "");

  const candidates = new Set<string>();
  for (const base of [trimmed, noWhitespace, stripped]) {
    if (!base) continue;
    candidates.add(base);
    candidates.add(base.toUpperCase());

    // Tastatur-Mapping DE ↔ US fuer typische Sonderzeichen:
    // ß → -, ? → _, ´ → =
    const deToUs = base
      .replace(/ß/g, "-")
      .replace(/\?/g, "_")
      .replace(/´/g, "=");
    if (deToUs !== base) {
      candidates.add(deToUs);
      candidates.add(deToUs.toUpperCase());
    }

    // Umgekehrte Richtung (US-Bindestrich liest sich auf DE-Layout
    // manchmal als Sonderzeichen, je nach Scanner-Config). Defensiv
    // beide Richtungen anbieten.
    const usToDe = base
      .replace(/-/g, "ß")
      .replace(/_/g, "?");
    if (usToDe !== base) {
      candidates.add(usToDe);
      candidates.add(usToDe.toUpperCase());
    }

    // Zero-Padding fuer Reader, die fuehrende Nullen unterdruecken.
    // Nur fuer rein numerische Codes mit 1..9 Stellen sinnvoll;
    // gepadded wird bis Laenge 10 (Standardlaenge der hier
    // verwendeten RFID-Tags). Da das Padding nach Direct-Lookup
    // greift, koennen "echte" kurze Codes nicht verdraengt werden.
    if (/^[0-9]{1,9}$/.test(base)) {
      const padded = base.padStart(10, "0");
      if (padded !== base) candidates.add(padded);
    }
  }
  return Array.from(candidates).filter((c) => c.length > 0);
}
