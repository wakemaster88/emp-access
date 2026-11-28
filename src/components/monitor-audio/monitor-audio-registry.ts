/**
 * Der Abspieler einer Monitor-Seite für andere Bausteine derselben Seite –
 * die Taste „Audio“ im Kopf des Check-in-Monitors setzt Stumm und Lautstärke
 * damit sofort auf diesem Gerät um, statt auf den nächsten Abruf zu warten.
 *
 * Der Abspieler hängt im Layout (`MonitorAudio`), die Taste in der Seite; ein
 * gemeinsamer React-Kontext müsste die Seite umschließen. So bleibt es bei
 * einer Zeile Registrierung.
 */
import type { MonitorAudioPlayer } from "./monitor-audio-player";

const players = new Map<string, MonitorAudioPlayer>();

/** Gibt die Abmeldung zurück. */
export function registerMonitorPlayer(token: string, player: MonitorAudioPlayer): () => void {
  players.set(token, player);
  return () => {
    if (players.get(token) === player) players.delete(token);
  };
}

export function monitorPlayer(token: string): MonitorAudioPlayer | null {
  return players.get(token) ?? null;
}
