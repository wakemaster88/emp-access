/**
 * Telegram-Foto der Überwachung an alle aktiven Chats eines Accounts. Die
 * Sichtungs-Routen des Hubs warten auf die Sendung, und ihre Laufzeit ist
 * begrenzt (vercel.json). Darum gehen alle Chats nebeneinander hinaus: Die
 * Sendung dauert höchstens eine Frist von sendTelegramPhoto, nicht eine je
 * Chat. Ein gescheiterter Chat hält die anderen nicht auf und endet im Log.
 */

export interface ChatSendResult {
  ok: boolean;
  description?: string;
}

/**
 * Sendet `send` für jeden Chat nebeneinander und gibt zurück, wie viele
 * angekommen sind. Wirft nie: Eine Antwort mit ok=false oder ein Fehler geht
 * an `onFail`.
 */
export async function sendToAllChats<C>(
  chats: readonly C[],
  send: (chat: C) => Promise<ChatSendResult>,
  onFail: (chat: C, why: { description?: string; error?: unknown }) => void,
): Promise<number> {
  const results = await Promise.all(
    chats.map(async (chat) => {
      try {
        const res = await send(chat);
        if (!res.ok) onFail(chat, { description: res.description });
        return res.ok;
      } catch (error) {
        onFail(chat, { error });
        return false;
      }
    }),
  );
  return results.filter(Boolean).length;
}
