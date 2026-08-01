/**
 * Läuft einmal beim Start des Servers.
 *
 * Die übrige Hintergrundarbeit im Projekt startet lazy aus API-Routen und
 * hängt damit daran, dass jemand das Dashboard offen hat. Für die
 * Drehkreuz-Kontrolle reicht das nicht: Die soll auch dann anschlagen, wenn
 * abends niemand auf den Bildschirm schaut.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ensureTailgateStarted } = await import("./lib/tailgate");
  ensureTailgateStarted();
}
