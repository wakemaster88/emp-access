/**
 * Fehlertexte fuer Passkey-Zeremonien im Browser. Gibt null zurueck, wenn der
 * Nutzer den Dialog selbst abgebrochen hat – dann soll kein Fehler erscheinen.
 */
export function passkeyErrorMessage(error: unknown): string | null {
  const name = error instanceof Error ? error.name : "";
  const code = (error as { code?: string } | null)?.code ?? "";
  if (name === "NotAllowedError" || name === "AbortError" || code === "ERROR_CEREMONY_ABORTED") return null;
  if (name === "InvalidStateError" || code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") {
    return "Dieses Gerät ist für dein Konto schon als Passkey eingerichtet.";
  }
  if (name === "SecurityError") return "Passkeys funktionieren nur über die eigentliche Adresse der App (https).";
  // Eigene Fehler (Antwort des Servers) tragen schon einen deutschen Text.
  if (error instanceof Error && name === "Error" && !code && error.message) return error.message;
  return "Passkey hat nicht geklappt. Bitte erneut versuchen.";
}

const noSubscribe = () => () => {};

/**
 * Ob der Browser Passkeys kann – als Hook fuer useSyncExternalStore: auf dem
 * Server (und beim ersten Rendern) `serverValue`, danach der echte Wert.
 */
export function passkeySupportSnapshot(supported: () => boolean, serverValue: boolean) {
  return [noSubscribe, supported, () => serverValue] as const;
}
