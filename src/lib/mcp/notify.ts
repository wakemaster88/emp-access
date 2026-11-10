import { prisma } from "@/lib/prisma";
import { sendTelegramMessage } from "@/lib/telegram";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Schaltende MCP-Aufrufe (Gerät, Kamera, Mäher, Tor) in Telegram melden, damit
 * nichts unbemerkt passiert – auch wenn das Token in falsche Hände gerät.
 */
export async function notifyMcpAction(
  accountId: number,
  tokenName: string,
  title: string,
  args: Record<string, unknown>,
): Promise<void> {
  const chats = await prisma.telegramConfig.findMany({
    where: { accountId, isActive: true },
    select: { botToken: true, chatId: true },
  });
  if (chats.length === 0) return;
  const detail = Object.entries(args)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `${k}=${String(v).slice(0, 60)}`)
    .join(", ");
  const text = `🤖 <b>MCP: ${esc(title)}</b>\n${esc(detail)}\nToken: ${esc(tokenName)}`;
  await Promise.all(
    chats.map((c) => sendTelegramMessage(c.botToken, c.chatId, text).catch(() => undefined)),
  );
}
