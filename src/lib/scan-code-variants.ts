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
  }
  return Array.from(candidates).filter((c) => c.length > 0);
}
