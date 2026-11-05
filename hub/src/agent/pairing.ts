/**
 * Kopplung des Telegram-Chats mit dem Hub-Assistenten.
 *
 * Der Bot redet nur mit freigeschalteten Chats. Schreibt ein unbekannter
 * Chat, erzeugt der Hub einen sechsstelligen Code und schickt ihn ueber den
 * bestehenden Alarm-Kanal der Cloud (Push + Alarm-Telegram). Wer den Code
 * im neuen Bot eingibt, ist freigeschaltet. Reine Logik ohne I/O, damit sie
 * testbar bleibt.
 */

export interface PairedChat {
  id: string;
  name: string;
  pairedAt: string;
}

export interface PairingState {
  chats: PairedChat[];
  code: string | null;
  codeExpiresAt: number;
  attempts: number;
}

export const CODE_TTL_MS = 15 * 60_000;
export const MAX_ATTEMPTS = 5;

export function newPairingState(chats: PairedChat[] = []): PairingState {
  return { chats, code: null, codeExpiresAt: 0, attempts: 0 };
}

export function isPaired(st: PairingState, chatId: string, envIds: string[] = []): boolean {
  return envIds.includes(chatId) || st.chats.some((c) => c.id === chatId);
}

export type PairingStep =
  | { kind: "issued"; code: string }
  | { kind: "pending" }
  | { kind: "paired"; chat: PairedChat }
  | { kind: "wrong"; left: number }
  | { kind: "locked" };

/**
 * Nachricht eines unbekannten Chats verarbeiten. `random` liefert den Code
 * (testbar), `now` die Zeit in ms.
 */
export function handleUnknownChat(
  st: PairingState,
  chatId: string,
  name: string,
  text: string,
  now: number,
  random: () => string
): PairingStep {
  const active = st.code !== null && now < st.codeExpiresAt;
  const candidate = text.replace(/\s+/g, "");
  if (active && /^\d{6}$/.test(candidate)) {
    if (st.attempts >= MAX_ATTEMPTS) return { kind: "locked" };
    if (candidate === st.code) {
      const chat = { id: chatId, name, pairedAt: new Date(now).toISOString() };
      st.chats = [...st.chats.filter((c) => c.id !== chatId), chat];
      st.code = null;
      st.codeExpiresAt = 0;
      st.attempts = 0;
      return { kind: "paired", chat };
    }
    st.attempts++;
    if (st.attempts >= MAX_ATTEMPTS) return { kind: "locked" };
    return { kind: "wrong", left: MAX_ATTEMPTS - st.attempts };
  }
  if (active) return st.attempts >= MAX_ATTEMPTS ? { kind: "locked" } : { kind: "pending" };
  const code = random();
  st.code = code;
  st.codeExpiresAt = now + CODE_TTL_MS;
  st.attempts = 0;
  return { kind: "issued", code };
}
